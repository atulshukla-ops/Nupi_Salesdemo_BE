import { Router } from "express";
import env from "../configs/env";
import { authRateLimit, publicRateLimit } from "../middlewares/rateLimit";
import { requireTeamKey } from "../middlewares/teamKey";
import assetRoute from "./asset.routes";
import demoRoute from "./demo.routes";
import flowRoute from "./flow.routes";
import libraryRoute from "./library.routes";
import localStorageRoute from "./localStorage.routes";
import productRoute from "./product.routes";
import publicRoute from "./public.routes";
import uploadRoute from "./upload.routes";

const router = Router();

// Public — client viewer, no team key
router.use("/public", publicRateLimit, publicRoute);

// Development storage (stand-in for S3). Access is granted by the signature in each URL.
if (env.storageDriver === "local") router.use("/storage-local", localStorageRoute);

// Everything below needs the shared team key
router.use(authRateLimit, requireTeamKey);
router.use("/", libraryRoute); // /bootstrap, /trash, /settings
router.use("/products", productRoute);
router.use("/assets", assetRoute);
router.use("/uploads", uploadRoute);
router.use("/demos", demoRoute);
router.use("/flows", flowRoute);

export default router;
