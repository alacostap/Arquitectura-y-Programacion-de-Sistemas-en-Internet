import type { Request, Response } from "express";
import { ObjectId, type Collection } from "mongodb";
import type { ClientesT } from "../models/banco.model.js";

let clientesCollection: Collection<ClientesT>;

export const configClientesCollection = (collection: Collection<ClientesT>) => {
    clientesCollection = collection
};

const paginacion = (req: Request): { pagina: number; limite: number } | null => {
    const pagina = Number(req.query.pagina ?? 1);
    const limite = Number(req.query.limite ?? 10);
    if (!Number.isInteger(pagina) || pagina < 1 || !Number.isInteger(limite) || limite < 1) return null;
    return { pagina, limite: Math.min(limite, 100) };
};

//endpoints para routes
export const getClientes = async (req: Request, res: Response) => {
    const page = paginacion(req);
    if (!page) return res.status(400).json({ message: "Parámetros de paginación no válidos" });

    try {
        const [datos, totalElementos] = await Promise.all([
            clientesCollection.find().sort({ nombre: 1 }).skip((page.pagina - 1) * page.limite).limit(page.limite).toArray(),
            clientesCollection.countDocuments()
        ]);
        return res.json({
            datos,
            pagina: page.pagina,
            limite: page.limite,
            totalElementos,
            totalPaginas: Math.ceil(totalElementos / page.limite)
        });
    } catch {
        return res.status(500).json({ message: "Error al obtener los clientes" });
    }
};

export const getClientesID = async (req: Request, res: Response) => {
    const id = String(req.params.id);
    if (!ObjectId.isValid(id)) return res.status(400).json({ message: "ID de cliente no válido" });

    try {
        const cliente = await clientesCollection.findOne({ _id: new ObjectId(id) });
        if (!cliente) return res.status(404).json({ message: "Cliente no encontrado" });
        return res.json(cliente);
    } catch {
        return res.status(500).json({ message: "Error al buscar el cliente" });
    }
};

export const createCliente = async (req: Request, res: Response) => {
    const nombre = typeof req.body?.nombre === "string" ? req.body.nombre.trim() : "";
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    const dni = typeof req.body?.dni === "string" ? req.body.dni.trim().toUpperCase() : "";

    if (!nombre || !email || !dni) {
        return res.status(400).json({ message: "Nombre, email y DNI son obligatorios" });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ message: "Email no válido" });
    }
    if (!/^\d{8}[A-Z]$/.test(dni)) {
        return res.status(400).json({ message: "DNI no válido" });
    }

    const cliente: ClientesT = { nombre, email, dni, creadoEn: new Date().toISOString() };
    try {
        const result = await clientesCollection.insertOne(cliente);
        return res.status(201).json({ _id: result.insertedId, ...cliente });
    } catch (error) {
        if (typeof error === "object" && error !== null && "code" in error && error.code === 11000) {
            return res.status(409).json({ message: "El email o DNI ya está registrado" });
        }
        return res.status(500).json({ message: "Error al crear el cliente" });
    }
};

export const changeCliente = async (req: Request, res: Response) => {
    const id = String(req.params.id);
    if (!ObjectId.isValid(id)) return res.status(400).json({ message: "ID de cliente no válido" });

    if (Object.hasOwn(req.body ?? {}, "dni")) {
        return res.status(400).json({ message: "El DNI no se puede modificar" });
    }

    const changes: Partial<Pick<ClientesT, "nombre" | "email">> = {};
    if (Object.hasOwn(req.body ?? {}, "nombre")) {
        if (typeof req.body.nombre !== "string" || !req.body.nombre.trim()) {
            return res.status(400).json({ message: "Nombre no válido" });
        }
        changes.nombre = req.body.nombre.trim();
    }
    if (Object.hasOwn(req.body ?? {}, "email")) {
        if (typeof req.body.email !== "string" || !req.body.email.trim()) {
            return res.status(400).json({ message: "Email no válido" });
        }
        const email = req.body.email.trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return res.status(400).json({ message: "Email no válido" });
        }
        changes.email = email;
    }
    if (Object.keys(changes).length === 0) {
        return res.status(400).json({ message: "Debe indicar nombre o email para modificar" });
    }

    try {
        const result = await clientesCollection.updateOne({ _id: new ObjectId(id) }, { $set: changes });
        if (result.matchedCount === 0) return res.status(404).json({ message: "Cliente no encontrado" });
        const cliente = await clientesCollection.findOne({ _id: new ObjectId(id) });
        return res.json(cliente);
    } catch (error) {
        if (typeof error === "object" && error !== null && "code" in error && error.code === 11000) {
            return res.status(409).json({ message: "El email ya está registrado" });
        }
        return res.status(500).json({ message: "Error al modificar el cliente" });
    }
};
