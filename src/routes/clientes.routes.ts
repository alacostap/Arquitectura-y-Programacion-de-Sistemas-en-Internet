import { Router } from "express";
import { changeCliente, createCliente, getClientes, getClientesID } from "../controllers/clientes.controller.js";

const router = Router();

router.get("/", getClientes);
router.get("/:id", getClientesID);
router.post("/", createCliente);
router.patch("/:id", changeCliente);

export default router;
