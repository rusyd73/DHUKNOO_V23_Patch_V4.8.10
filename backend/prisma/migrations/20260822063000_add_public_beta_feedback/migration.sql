CREATE TABLE "PublicSurveyResponse" (
    "id" TEXT NOT NULL,
    "audience" TEXT NOT NULL,
    "answers" JSONB NOT NULL,
    "source" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PublicSurveyResponse_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PublicBetaRegistration" (
    "id" TEXT NOT NULL,
    "audience" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "whatsapp" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "note" TEXT,
    "consent" BOOLEAN NOT NULL DEFAULT false,
    "source" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PublicBetaRegistration_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PublicSurveyResponse_audience_createdAt_idx" ON "PublicSurveyResponse"("audience", "createdAt");
CREATE INDEX "PublicSurveyResponse_createdAt_idx" ON "PublicSurveyResponse"("createdAt");
CREATE UNIQUE INDEX "PublicBetaRegistration_whatsapp_key" ON "PublicBetaRegistration"("whatsapp");
CREATE INDEX "PublicBetaRegistration_audience_createdAt_idx" ON "PublicBetaRegistration"("audience", "createdAt");
CREATE INDEX "PublicBetaRegistration_city_idx" ON "PublicBetaRegistration"("city");
CREATE INDEX "PublicBetaRegistration_createdAt_idx" ON "PublicBetaRegistration"("createdAt");
