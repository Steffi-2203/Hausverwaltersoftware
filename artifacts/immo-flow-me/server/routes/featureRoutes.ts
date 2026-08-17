import { Router } from "express";
import wegRoutes from "./wegRoutes";
import financeRoutes from "./financeRoutes";
import adminRoutes from "./adminRoutes";

const router = Router();

router.use(wegRoutes);
router.use(financeRoutes);
router.use(adminRoutes);

export default router;
