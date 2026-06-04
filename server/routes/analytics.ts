import { Router } from "express";
import { CallLogModel } from "../models/CallLog.js";
import { logger } from "../utils.js";

const router = Router();

// GET /api/analytics/stats — Aggregate stats
router.get("/stats", async (_req, res) => {
  try {
    const totalCalls = await CallLogModel.countDocuments({});
    const completedCalls = await CallLogModel.find({ status: "completed" });

    const totalDurationSeconds = completedCalls.reduce((sum, c) => sum + (c.durationSeconds || 0), 0);
    const avgDurationSeconds = completedCalls.length > 0
      ? Math.round(totalDurationSeconds / completedCalls.length)
      : 0;

    // Calls by persona
    const byPersona = await CallLogModel.aggregate([
      { $group: { _id: "$personaName", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]);
    const callsByPersona: Record<string, number> = {};
    for (const item of byPersona) {
      callsByPersona[item._id || "Unknown"] = item.count;
    }

    // Calls by status
    const byStatus = await CallLogModel.aggregate([
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]);
    const callsByStatus: Record<string, number> = {};
    for (const item of byStatus) {
      callsByStatus[item._id || "unknown"] = item.count;
    }

    // Calls by day (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const byDay = await CallLogModel.aggregate([
      { $match: { startedAt: { $gte: thirtyDaysAgo } } },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$startedAt" } },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);
    const callsByDay = byDay.map((d) => ({ date: d._id, count: d.count }));

    // Calls by provider
    const byProvider = await CallLogModel.aggregate([
      { $group: { _id: "$provider", count: { $sum: 1 } } },
    ]);
    const callsByProvider: Record<string, number> = {};
    for (const item of byProvider) {
      callsByProvider[item._id || "unknown"] = item.count;
    }

    // Today's call count
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const callsToday = await CallLogModel.countDocuments({ startedAt: { $gte: todayStart } });

    res.json({
      success: true,
      data: {
        totalCalls,
        totalDurationSeconds,
        avgDurationSeconds,
        callsToday,
        callsByPersona,
        callsByStatus,
        callsByDay,
        callsByProvider,
      },
    });
  } catch (err: any) {
    logger.error("Error aggregating call stats:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/analytics/calls — Paginated call history
router.get("/calls", async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
    const skip = (page - 1) * limit;

    const filter: any = {};
    if (req.query.personaId) filter.personaId = req.query.personaId;
    if (req.query.status) filter.status = req.query.status;
    if (req.query.provider) filter.provider = req.query.provider;

    const total = await CallLogModel.countDocuments(filter);
    const calls = await CallLogModel.find(filter)
      .sort({ startedAt: -1 })
      .skip(skip)
      .limit(limit)
      .select("-transcript -toolCallsUsed"); // Exclude heavy fields in list view

    res.json({
      success: true,
      data: calls,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (err: any) {
    logger.error("Error fetching call history logs:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/analytics/calls/:callId — Full call detail with transcript
router.get("/calls/:callId", async (req, res) => {
  try {
    const call = await CallLogModel.findOne({ callId: req.params.callId });
    if (!call) {
      return res.status(404).json({ success: false, message: "Call not found." });
    }
    res.json({ success: true, data: call });
  } catch (err: any) {
    logger.error("Error fetching call details:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE /api/analytics/calls/:callId — Delete a call log
router.delete("/calls/:callId", async (req, res) => {
  try {
    await CallLogModel.deleteOne({ callId: req.params.callId });
    res.json({ success: true });
  } catch (err: any) {
    logger.error("Error deleting call log:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
