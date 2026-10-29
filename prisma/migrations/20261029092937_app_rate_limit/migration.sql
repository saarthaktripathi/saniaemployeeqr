-- CreateTable
CREATE TABLE "app_rate_limit" (
    "key" TEXT NOT NULL,
    "windowStart" BIGINT NOT NULL,
    "count" INTEGER NOT NULL,

    CONSTRAINT "app_rate_limit_pkey" PRIMARY KEY ("key")
);
