"use client";

import { Beacon, type BeaconPose } from "@openpromoter/ui";
import { toast } from "sonner";

/** A success toast with Beacon. Only for the few friendly moments: payouts sent, invites, setup steps. */
export const mascotToast = (message: string, pose: BeaconPose) =>
  toast.success(message, {
    icon: <Beacon pose={pose} size={32} />,
    classNames: { icon: "!m-0 !mr-1 !size-8" },
  });
