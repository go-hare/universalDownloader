const express = require("express");
const router = express.Router();
const { handleAutoDownload, handleDetectPlatform } = require("../controllers/autoController");

router.get("/download", handleAutoDownload);
router.get("/detect", handleDetectPlatform);

module.exports = router;
