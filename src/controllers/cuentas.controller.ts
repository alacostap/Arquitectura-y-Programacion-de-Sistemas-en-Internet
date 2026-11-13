import { randomInt } from "node:crypto";
import type { Request, Response } from "express";
import { ObjectId, type Collection } from "mongodb";
import type { ClientesT, CuentasT, EstadoCuenta } from "../models/banco.model.js";

let cuentasCollection: Collection<CuentasT>;

export const configCuentasCollection = (collection: Collection<CuentasT>) => {
    cuentasCollection = collection;
};

const generarIBAN = (): string => {
    const bban = Array.from({ length: 20 }, () => randomInt(0, 10)).join("");
    const resto = modulo97(`${bban}142800`);
    const control = String(98 - resto).padStart(2, "0");
    return `ES${control}${bban}`;
};

const modulo97 = (numero: string): number => {
    let resto = 0;
    for (const digito of numero) resto = (resto * 10 + Number(digito)) % 97;
    return resto;
};

export const esIBANValido = (iban: string): boolean => {
    const normalizado = iban.replaceAll(" ", "").toUpperCase();
    if (normalizado.length !== 24 || !normalizado.startsWith("ES")) return false;
    for (const digito of normalizado.slice(2)) {
        if (digito < "0" || digito > "9") return false;
    }

    const reordenado = `${normalizado.slice(4)}${normalizado.slice(0, 4)}`;
    let resto = 0;
    for (const caracter of reordenado) {
        const codigo = caracter.charCodeAt(0);
        const valor = codigo >= 65 && codigo <= 90 ? String(codigo - 55) : caracter;
        for (const digito of valor) resto = (resto * 10 + Number(digito)) % 97;
    }
    return resto === 1;
};

const paginacion = (req: Request) => {
    const pagina = Number(req.query.pagina ?? 1);
    const limiteSolicitado = Number(req.query.limite ?? 10);
    if (!Number.isSafeInteger(pagina) || pagina < 1 || !Number.isSafeInteger(limiteSolicitado) || limiteSolicitado < 1) {
        return null;
    }
    return { pagina, limite: Math.min(limiteSolicitado, 100) };
};

const fechaFiltro = (desde: unknown, hasta: unknown): Record<string, string> | null => {
    const filtro: Record<string, string> = {};
    if (typeof desde === "string") {
        const fecha = new Date(desde);
        if (Number.isNaN(fecha.getTime())) return null;
        filtro.$gte = fecha.toISOString();
    }
    if (typeof hasta === "string") {
        const fecha = new Date(hasta);
        if (Number.isNaN(fecha.getTime())) return null;
        if (hasta.length === 10) fecha.setUTCHours(23, 59, 59, 999);
        filtro.$lte = fecha.toISOString();
    }
    return filtro;
};

//endpoints para routes
export const createCuenta = async (req: Request, res: Response) => {
    const clienteId = typeof req.body?.clienteId === "string" ? req.body.clienteId.trim() : "";
    const tipo = req.body?.tipo;
    if (!ObjectId.isValid(clienteId) || (tipo !== "corriente" && tipo !== "ahorro")) {
        return res.status(400).json({ message: "Se requiere un clienteId válido y tipo corriente o ahorro" });
    }

    const clientesCollection = cuentasCollection.db.collection<ClientesT>("Clientes");
    const session = cuentasCollection.db.client.startSession();
    try {
        for (let intento = 0; intento < 10; intento++) {
            const cuenta = {
                clienteId,
                tipo,
                saldo: 0,
                descubiertoMax: tipo === "corriente" ? 50000 : 0,
                estado: "activa",
                creadaEn: new Date().toISOString(),
                iban: generarIBAN()
            };
            try {
                let insertedId: ObjectId | undefined;
                const errorRespuesta = await session.withTransaction(async () => {
                    const cliente = await clientesCollection.findOne({ _id: new ObjectId(clienteId) }, { session });
                    if (!cliente) return { status: 404, message: "Cliente no encontrado" };

                    const lock = await clientesCollection.updateOne(
                        { _id: new ObjectId(clienteId) },
                        { $set: { _cuentaCreacionLock: new ObjectId().toHexString() } },
                        { session }
                    );
                    if (lock.matchedCount !== 1) return { status: 404, message: "Cliente no encontrado" };

                    const cuentasAbiertas = await cuentasCollection.countDocuments({
                        clienteId,
                        estado: { $ne: "cerrada" }
                    }, { session });
                    if (cuentasAbiertas >= 3) {
                        await clientesCollection.updateOne(
                            { _id: new ObjectId(clienteId) },
                            { $unset: { _cuentaCreacionLock: "" } },
                            { session }
                        );
                        return { status: 409, message: "El cliente ya tiene 3 cuentas no cerradas" };
                    }

                    await clientesCollection.updateOne(
                        { _id: new ObjectId(clienteId) },
                        { $unset: { _cuentaCreacionLock: "" } },
                        { session }
                    );
                    const result = await cuentasCollection.db.collection("Cuentas").insertOne(cuenta, { session });
                    insertedId = result.insertedId;
                    return null;
                });
                if (errorRespuesta) {
                    return res.status(errorRespuesta.status).json({ message: errorRespuesta.message });
                }
                return res.status(201).json({ _id: insertedId, ...cuenta });
            } catch (error) {
                const duplicado = typeof error === "object" && error !== null && "code" in error && error.code === 11000;
                if (!duplicado) throw error;
            }
        }
        return res.status(500).json({ message: "No se pudo generar un IBAN único" });
    } catch {
        return res.status(500).json({ message: "Error al crear la cuenta" });
    } finally {
        await session.endSession();
    }
};

export const getCuentas = async (req: Request, res: Response) => {
    const page = paginacion(req);
    if (!page) return res.status(400).json({ message: "Parámetros de paginación no válidos" });

    const filtro: Record<string, unknown> = {};
    for (const campo of ["tipo", "estado"] as const) {
        const valor = req.query[campo];
        if (typeof valor === "string" && valor.trim()) filtro[campo] = valor.trim();
    }
    const clienteId = req.query.clienteId;
    if (typeof clienteId === "string" && clienteId.trim()) filtro.clienteId = clienteId.trim();
    const fechas = fechaFiltro(req.query.desde, req.query.hasta);
    if (!fechas) return res.status(400).json({ message: "Rango de fechas no válido" });
    if (Object.keys(fechas).length) filtro.creadaEn = fechas;

    try {
        const [datos, totalElementos] = await Promise.all([
            cuentasCollection.find(filtro).sort({ creadaEn: -1 }).skip((page.pagina - 1) * page.limite).limit(page.limite).toArray(),
            cuentasCollection.countDocuments(filtro)
        ]);
        return res.json({
            datos,
            pagina: page.pagina,
            limite: page.limite,
            totalElementos,
            totalPaginas: Math.ceil(totalElementos / page.limite)
        });
    } catch {
        return res.status(500).json({ message: "Error al obtener las cuentas" });
    }
};

export const getCuentasID = async (req: Request, res: Response) => {
    const id = String(req.params.id);
    if (!ObjectId.isValid(id)) return res.status(400).json({ message: "ID de cuenta no válido" });

    try {
        const cuenta = await cuentasCollection.findOne({ _id: new ObjectId(id) });
        if (!cuenta) return res.status(404).json({ message: "Cuenta no encontrada" });
        const cliente = await cuentasCollection.db.collection<ClientesT>("Clientes").findOne({
            _id: new ObjectId(cuenta.clienteId)
        });
        return res.json({
            ...cuenta,
            nombre: cliente?.nombre ?? null,
            email: cliente?.email ?? null
        });
    } catch {
        return res.status(500).json({ message: "Error al obtener la cuenta" });
    }
};

export const changeCuentaEstado = async (req: Request, res: Response) => {
    const id = String(req.params.id);
    if (!ObjectId.isValid(id)) return res.status(400).json({ message: "ID de cuenta no válido" });

    const estadoSolicitado = req.body?.estado;
    const estados: EstadoCuenta[] = ["activa", "bloqueada", "cerrada"];
    if (typeof estadoSolicitado !== "string" || !estados.includes(estadoSolicitado as EstadoCuenta)) {
        return res.status(400).json({ message: "Estado inexistente o no válido" });
    }

    try {
        const cuenta = await cuentasCollection.findOne({ _id: new ObjectId(id) });
        if (!cuenta) return res.status(404).json({ message: "Cuenta no encontrada" });

        const transicionPermitida =
            (cuenta.estado === "activa" && (estadoSolicitado === "bloqueada" || estadoSolicitado === "cerrada")) ||
            (cuenta.estado === "bloqueada" && (estadoSolicitado === "activa" || estadoSolicitado === "cerrada"));
        if (!transicionPermitida) {
            return res.status(409).json({
                message: `Transición no permitida: estado actual "${cuenta.estado}", estado solicitado "${estadoSolicitado}"`
            });
        }
        if (estadoSolicitado === "cerrada" && cuenta.saldo !== 0) {
            return res.status(409).json({ message: "La cuenta solo puede cerrarse con saldo exactamente 0" });
        }

        const result = await cuentasCollection.updateOne(
            {
                _id: new ObjectId(id),
                estado: cuenta.estado,
                ...(estadoSolicitado === "cerrada" ? { saldo: 0 } : {})
            },
            { $set: { estado: estadoSolicitado } }
        );
        if (result.matchedCount === 0) {
            const estadoActual = await cuentasCollection.findOne({ _id: new ObjectId(id) });
            return res.status(409).json({
                message: `Transición no permitida: estado actual "${estadoActual?.estado ?? "desconocido"}", estado solicitado "${estadoSolicitado}"`
            });
        }
        return res.json({ message: "Estado de la cuenta actualizado", estado: estadoSolicitado });
    } catch {
        return res.status(500).json({ message: "Error al actualizar el estado de la cuenta" });
    }
};

export const getCuentasIDMovimientos = async (req: Request, res: Response) => {
    const id = String(req.params.id);
    if (!ObjectId.isValid(id)) return res.status(400).json({ message: "ID de cuenta no válido" });

    try {
        const cuenta = await cuentasCollection.findOne({ _id: new ObjectId(id) });
        if (!cuenta) return res.status(404).json({ message: "Cuenta no encontrada" });
    } catch {
        return res.status(500).json({ message: "Error al buscar la cuenta" });
    }

    const page = paginacion(req);
    if (!page) return res.status(400).json({ message: "Parámetros de paginación no válidos" });

    const filtro: Record<string, unknown> = { cuentaId: id };
    if (typeof req.query.tipo === "string" && req.query.tipo.trim()) {
        const tipos = req.query.tipo.split(",").map((tipo) => tipo.trim()).filter(Boolean);
        if (tipos.length) filtro.tipo = tipos.length === 1 ? tipos[0] : { $in: tipos };
    }
    if (typeof req.query.categoria === "string" && req.query.categoria.trim()) {
        filtro.categoria = req.query.categoria.trim();
    }
    const fechas = fechaFiltro(req.query.desde, req.query.hasta);
    if (!fechas) return res.status(400).json({ message: "Rango de fechas no válido" });
    if (Object.keys(fechas).length) filtro.fecha = fechas;

    const orden = req.query.orden ?? "-fecha";
    if (orden !== "fecha" && orden !== "-fecha") {
        return res.status(400).json({ message: "Orden no válido; use fecha o -fecha" });
    }

    try {
        const movimientosCollection = cuentasCollection.db.collection("Operaciones");
        const [datos, totalElementos] = await Promise.all([
            movimientosCollection.find(filtro).sort({ fecha: orden === "fecha" ? 1 : -1 })
                .skip((page.pagina - 1) * page.limite).limit(page.limite).toArray(),
            movimientosCollection.countDocuments(filtro)
        ]);
        return res.json({
            datos,
            pagina: page.pagina,
            limite: page.limite,
            totalElementos,
            totalPaginas: Math.ceil(totalElementos / page.limite)
        });
    } catch {
        return res.status(500).json({ message: "Error al obtener los movimientos" });
    }
};