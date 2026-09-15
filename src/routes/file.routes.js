import { Router } from "express";
import * as ctrl from "../controllers/file.controller.js";
import { protect, authorize } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { upload } from "../middleware/upload.js";
import { fileSchemas, idParam } from "../validators/index.js";

const router = Router();

router.use(protect);

router.get("/", validate({ query: fileSchemas.list }), ctrl.listFiles);
router.get("/stats", ctrl.fileStats);

// multer parses the multipart body first, then the fields are validated.
router.post("/", upload.array("files", 10), validate({ body: fileSchemas.upload }), ctrl.uploadFiles);
router.delete("/:id", authorize("ADMIN"), validate({ params: idParam }), ctrl.deleteFile);

export default router;
