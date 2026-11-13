import type { Request, Response } from "express";
import { ObjectId, type ClientSession, type Collection } from "mongodb";
import type { CuentasT, OperacionesT } from "../models/banco.model.js";
import { esIBANValido } from "./cuentas.controller.js";

let operacionesCollection: Collection<OperacionesT>;
let cuentasCollection: Collection<CuentasT>;

export const configOperacionesCollection = (
    movimientos: Collection<OperacionesT>,
    cuentas: Collection<CuentasT>
) => {
    operacionesCollection = movimientos;
    cuentasCollection = cuentas;
};

const validarOperacion = (body: Request["body"]) => {
    const importe = body?.importe;
    const concepto = typeof body?.concepto === "string" ? body.concepto.trim() : "";
    const categoria = typeof body?.categoria === "string" && body.categoria.trim()
        ? body.categoria.trim()
        : "otros";
    if (!Number.isSafeInteger(importe) || importe <= 0 || !concepto) {
        return null;
    }
    return { importe: importe as number, concepto, categoria };
};

const inicioDia = (fecha: Date): string => {
    const inicio = new Date(fecha);
    inicio.setHours(0, 0, 0, 0);
    return inicio.toISOString();
};

const comprobarLimiteDiario = async (cuentaId: string, session: ClientSession, importe: number) => {
    const desde = inicioDia(new Date());
    const salidas = await operacionesCollection.find({
        cuentaId,
        tipo: { $in: ["retirada", "transferencia_emitida", "comision"] },
        fecha: { $gte: desde }
    }, { session }).toArray();
    const total = salidas.reduce((suma, movimiento) => suma + Math.abs(movimiento.importe), 0);
    if (total + importe > 100000) {
        throw Object.assign(new Error(`El límite diario de retiradas es 100000; ya se han utilizado ${total}`), { status: 409 });
    }
};

//endpoints para routes
export const ingresarDinero = async (req: Request, res: Response) => {
    const id = String(req.params.id);
    if (!ObjectId.isValid(id)) return res.status(400).json({ message: "ID de cuenta no válido" });
    const datos = validarOperacion(req.body);
    if (!datos) return res.status(400).json({ message: "El importe debe ser un entero positivo y el concepto es obligatorio" });

    const session = cuentasCollection.db.client.startSession();
    try {
        let movimiento: OperacionesT | undefined;
        await session.withTransaction(async () => {
            const cuenta = await cuentasCollection.findOne({ _id: new ObjectId(id) }, { session });
            if (!cuenta) throw Object.assign(new Error("Cuenta no encontrada"), { status: 404 });
            if (cuenta.estado === "cerrada") throw Object.assign(new Error("La cuenta cerrada no admite operaciones"), { status: 409 });
            const saldoResultante = cuenta.saldo + datos.importe;
            const result = await cuentasCollection.updateOne(
                { _id: cuenta._id, estado: { $in: ["activa", "bloqueada"] } },
                { $inc: { saldo: datos.importe } },
                { session }
            );
            if (result.matchedCount !== 1) throw Object.assign(new Error("El estado de la cuenta no permite el ingreso"), { status: 409 });
            movimiento = {
                cuentaId: id,
                tipo: "ingreso",
                importe: datos.importe,
                saldoResultante,
                concepto: datos.concepto,
                categoria: datos.categoria,
                fecha: new Date().toISOString()
            };
            await operacionesCollection.insertOne(movimiento, { session });
        });
        return res.status(201).json(movimiento);
    } catch (error) {
        if (error instanceof Error && "status" in error && typeof error.status === "number") {
            return res.status(error.status).json({ message: error.message });
        }
        return res.status(500).json({ message: "No se pudo registrar el ingreso" });
    } finally {
        await session.endSession();
    }
};

export const retirarDinero = async (req: Request, res: Response) => {
    const id = String(req.params.id);
    if (!ObjectId.isValid(id)) return res.status(400).json({ message: "ID de cuenta no válido" });
    const datos = validarOperacion(req.body);
    if (!datos) return res.status(400).json({ message: "El importe debe ser un entero positivo y el concepto es obligatorio" });

    const session = cuentasCollection.db.client.startSession();
    try {
        let movimiento: OperacionesT | undefined;
        await session.withTransaction(async () => {
            const cuenta = await cuentasCollection.findOne({ _id: new ObjectId(id) }, { session });
            if (!cuenta) throw Object.assign(new Error("Cuenta no encontrada"), { status: 404 });
            if (cuenta.estado !== "activa") {
                throw Object.assign(new Error(`La cuenta en estado "${cuenta.estado}" no permite retiradas`), { status: 409 });
            }
            await comprobarLimiteDiario(id, session, datos.importe);
            const minimo = -cuenta.descubiertoMax;
            const saldoResultante = cuenta.saldo - datos.importe;
            if (saldoResultante < minimo) {
                throw Object.assign(new Error(`Saldo disponible incluyendo descubierto: ${cuenta.saldo + cuenta.descubiertoMax}`), { status: 409 });
            }
            const result = await cuentasCollection.updateOne(
                { _id: cuenta._id, estado: "activa", saldo: { $gte: datos.importe - cuenta.descubiertoMax } },
                { $inc: { saldo: -datos.importe } },
                { session }
            );
            if (result.matchedCount !== 1) throw Object.assign(new Error("Saldo insuficiente o la cuenta ha cambiado de estado"), { status: 409 });
            movimiento = {
                cuentaId: id,
                tipo: "retirada",
                importe: -datos.importe,
                saldoResultante,
                concepto: datos.concepto,
                categoria: datos.categoria,
                fecha: new Date().toISOString()
            };
            await operacionesCollection.insertOne(movimiento, { session });
        });
        return res.status(201).json(movimiento);
    } catch (error) {
        if (error instanceof Error && "status" in error && typeof error.status === "number") {
            return res.status(error.status).json({ message: error.message });
        }
        return res.status(500).json({ message: "No se pudo registrar la retirada" });
    } finally {
        await session.endSession();
    }
};

export const transferirDinero = async (req: Request, res: Response) => {
    const ibanOrigen = typeof req.body?.ibanOrigen === "string" ? req.body.ibanOrigen.replaceAll(" ", "").toUpperCase() : "";
    const ibanDestino = typeof req.body?.ibanDestino === "string" ? req.body.ibanDestino.replaceAll(" ", "").toUpperCase() : "";
    if (!esIBANValido(ibanOrigen) || !esIBANValido(ibanDestino)) {
        return res.status(400).json({ message: "Los dos IBAN deben ser válidos" });
    }
    if (ibanOrigen === ibanDestino) return res.status(400).json({ message: "Las cuentas de origen y destino deben ser distintas" });

    const datos = validarOperacion(req.body);
    if (!datos) return res.status(400).json({ message: "El importe debe ser un entero positivo y el concepto es obligatorio" });

    const session = cuentasCollection.db.client.startSession();
    try {
        let movimientos: OperacionesT[] = [];
        await session.withTransaction(async () => {
            const origen = await cuentasCollection.findOne({ iban: ibanOrigen }, { session });
            const destino = await cuentasCollection.findOne({ iban: ibanDestino }, { session });
            if (!origen || !destino) throw Object.assign(new Error("Cuenta de origen o destino no encontrada"), { status: 404 });
            if (origen.estado !== "activa") {
                throw Object.assign(new Error(`La cuenta de origen en estado "${origen.estado}" no permite transferencias`), { status: 409 });
            }
            if (destino.estado === "cerrada") {
                throw Object.assign(new Error("La cuenta de destino cerrada no admite transferencias"), { status: 409 });
            }

            const comision = origen.clienteId === destino.clienteId
                ? 0
                : Math.max(100, Math.ceil(datos.importe / 200));
            const totalSalida = datos.importe + comision;
            const minimo = -origen.descubiertoMax;
            const saldoOrigenFinal = origen.saldo - totalSalida;
            if (saldoOrigenFinal < minimo) {
                throw Object.assign(new Error(`Saldo disponible incluyendo descubierto: ${origen.saldo + origen.descubiertoMax}`), { status: 409 });
            }
            await comprobarLimiteDiario(origen._id!.toHexString(), session, totalSalida);

            const actualizacionOrigen = await cuentasCollection.updateOne(
                {
                    _id: origen._id,
                    estado: "activa",
                    saldo: { $gte: totalSalida - origen.descubiertoMax }
                },
                { $inc: { saldo: -totalSalida } },
                { session }
            );
            if (actualizacionOrigen.matchedCount !== 1) {
                throw Object.assign(new Error("Saldo insuficiente o la cuenta de origen ha cambiado"), { status: 409 });
            }
            const actualizacionDestino = await cuentasCollection.updateOne(
                { _id: destino._id, estado: { $in: ["activa", "bloqueada"] } },
                { $inc: { saldo: datos.importe } },
                { session }
            );
            if (actualizacionDestino.matchedCount !== 1) {
                throw Object.assign(new Error("La cuenta de destino ha cambiado de estado"), { status: 409 });
            }

            const transferenciaId = new ObjectId().toHexString();
            const fecha = new Date().toISOString();
            movimientos = [
                {
                    cuentaId: origen._id!.toHexString(),
                    tipo: "transferencia_emitida",
                    importe: -datos.importe,
                    saldoResultante: origen.saldo - datos.importe,
                    concepto: datos.concepto,
                    categoria: datos.categoria,
                    transferenciaId,
                    fecha
                },
                {
                    cuentaId: destino._id!.toHexString(),
                    tipo: "transferencia_recibida",
                    importe: datos.importe,
                    saldoResultante: destino.saldo + datos.importe,
                    concepto: datos.concepto,
                    categoria: datos.categoria,
                    transferenciaId,
                    fecha
                }
            ];
            if (comision > 0) {
                movimientos.push({
                    cuentaId: origen._id!.toHexString(),
                    tipo: "comision",
                    importe: -comision,
                    saldoResultante: saldoOrigenFinal,
                    concepto: `Comisión por transferencia: ${datos.concepto}`,
                    categoria: datos.categoria,
                    transferenciaId,
                    fecha
                });
            }
            await operacionesCollection.insertMany(movimientos, { session });
        });
        return res.status(201).json({ transferenciaId: movimientos[0]?.transferenciaId, movimientos });
    } catch (error) {
        if (error instanceof Error && "status" in error && typeof error.status === "number") {
            return res.status(error.status).json({ message: error.message });
        }
        return res.status(500).json({ message: "No se pudo registrar la transferencia" });
    } finally {
        await session.endSession();
    }
};
