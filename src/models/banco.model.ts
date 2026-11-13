import type { ObjectId } from "mongodb";

export type ClientesT = {
    _id?: ObjectId;
    nombre: string;
    email: string;
    dni: string;
    creadoEn: string;
};

export type EstadoCuenta = "activa" | "bloqueada" | "cerrada";

export type CuentasT = {
    _id?: ObjectId;
    iban: string;
    clienteId: string;
    tipo: "corriente" | "ahorro";
    saldo: number;
    descubiertoMax: number;
    estado: EstadoCuenta;
    creadoEn: string;
};

export type TipoMovimiento = "ingreso" | "retirada" | "transferencia_emitida" | "transferencia_recibida" | "comision";

export type OperacionesT = {
    _id?: ObjectId;
    cuentaId: string;
    tipo: TipoMovimiento;
    importe: number;
    saldoResultante: number;
    concepto: string;
    categoria: string;
    transferenciaId?: string;
    fecha: string;
};
