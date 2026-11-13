import { Router } from "express";
import { ingresarDinero, retirarDinero, transferirDinero } from "../controllers/operaciones.controller.js";

const router = Router();

router.post("/cuentas/:id/ingresos", ingresarDinero);
router.post("/cuentas/:id/retiradas", retirarDinero);
router.post("/transferencias", transferirDinero);

export default router;
