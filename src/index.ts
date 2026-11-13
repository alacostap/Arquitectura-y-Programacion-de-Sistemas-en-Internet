import express from "express";
import type { Collection } from "mongodb";
import { connectMongo } from "./config/database.js";

import { configClientesCollection } from "./controllers/clientes.controller.js";
import { configCuentasCollection } from "./controllers/cuentas.controller.js";
import { configOperacionesCollection } from "./controllers/operaciones.controller.js";

import clientesRoutes from "./routes/clientes.routes.js";
import cuentasRoutes from "./routes/cuentas.routes.js";
import operacionesRoutes from "./routes/operaciones.routes.js";
import type { ClientesT, CuentasT, OperacionesT } from "./models/banco.model.js";

const app = express();

app.use(express.json());

const startServer = async () => {
    try {
        const db = await connectMongo();
        const clientesCollection: Collection<ClientesT> = db.collection("Clientes");
        const cuentasCollection: Collection<CuentasT> = db.collection("Cuentas");
        const operacionesCollection: Collection<OperacionesT> = db.collection("Operaciones");

        await Promise.all([
            clientesCollection.createIndex({ email: 1 }, {
                unique: true,
                collation: { locale: "en", strength: 2 }
            }),
            clientesCollection.createIndex({ dni: 1 }, {
                unique: true,
                collation: { locale: "en", strength: 2 }
            }),
            cuentasCollection.createIndex({ iban: 1 }, { unique: true })
        ]);

        configClientesCollection(clientesCollection);
        configCuentasCollection(cuentasCollection);
        configOperacionesCollection(operacionesCollection, cuentasCollection);

        app.use("/clientes", clientesRoutes);
        app.use("/cuentas", cuentasRoutes);
        app.use("/operaciones", operacionesRoutes);
        app.use(operacionesRoutes);

        app.listen(3000, () => console.log("Api funcionando en el puerto 3000"));
    } catch (error: unknown) {
        console.error("No se pudo iniciar la API o crear los índices únicos:", error);
    }
};

startServer();
