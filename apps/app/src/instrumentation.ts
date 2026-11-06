export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.NODE_ENV !== "test") {
    const { startWorker } = await import("./server/worker");
    startWorker();
  }
}
