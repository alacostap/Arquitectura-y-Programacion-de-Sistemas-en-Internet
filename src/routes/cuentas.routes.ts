import { Router } from "express";
import { createCuenta, getCuentas, getCuentasID, getCuentasIDMovimientos, changeCuentaEstado } from "../controllers/cuentas.controller.js";

const router = Router();

router.get("/", getCuentas);
router.post("/", createCuenta);
router.get("/:id/movimientos", getCuentasIDMovimientos);
router.patch("/:id/estado", changeCuentaEstado);
router.get("/:id", getCuentasID);

export default router;
