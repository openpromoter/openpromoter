-- Paddle, Polar and Chargebee now take livemode from the connection (their payloads carry no sandbox flag).
-- Connections saved before the Sandbox switch existed were all treated as live, so keep them live.
UPDATE "billing_connection" SET "livemode" = true WHERE "provider" IN ('paddle', 'lemonsqueezy', 'polar', 'chargebee');
