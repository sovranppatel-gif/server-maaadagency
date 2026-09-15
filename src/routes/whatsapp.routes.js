import { Router } from "express";
import * as ctrl from "../controllers/whatsapp.controller.js";
import { protect, authorize } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { idParam, whatsappSchemas } from "../validators/index.js";

const router = Router();

/*
 * Webhook endpoints are public by design: Meta calls them directly and
 * authenticates with the verify token plus an HMAC request signature.
 */
router.get("/webhook", ctrl.verifyWebhook);
router.post("/webhook", ctrl.receiveWebhook);

router.use(protect);

router.get("/status", ctrl.connectionStatus);

router.get("/conversations", validate({ query: whatsappSchemas.conversations }), ctrl.listConversations);
router.get("/conversations/:id", validate({ params: idParam }), ctrl.getConversation);
router.get("/conversations/:id/messages", validate({ params: idParam }), ctrl.listMessages);
router.post("/conversations/:id/read", validate({ params: idParam }), ctrl.markConversationRead);

router.post("/send", validate({ body: whatsappSchemas.send }), ctrl.sendMessage);

router.get("/bot-flow", ctrl.listBotSteps);
router.post("/bot-flow", authorize("ADMIN"), validate({ body: whatsappSchemas.botStep }), ctrl.createBotStep);
router.patch("/bot-flow/reorder", authorize("ADMIN"), validate({ body: whatsappSchemas.reorder }), ctrl.reorderBotSteps);
router.patch("/bot-flow/:id", authorize("ADMIN"), validate({ params: idParam }), ctrl.updateBotStep);
router.delete("/bot-flow/:id", authorize("ADMIN"), validate({ params: idParam }), ctrl.deleteBotStep);

export default router;
