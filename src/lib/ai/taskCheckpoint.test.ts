import { taskPersistenceStatus } from "./taskCheckpoint";
if (!["configured", "unconfigured"].includes(taskPersistenceStatus())) throw new Error("invalid task persistence status");
console.log("Task checkpoint checks passed.");
