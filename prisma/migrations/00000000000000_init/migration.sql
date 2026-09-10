-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Language" AS ENUM ('FR', 'EN');

-- CreateEnum
CREATE TYPE "Plan" AS ENUM ('FREE', 'PREMIUM');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('PENDING_VERIFICATION', 'ACTIVE', 'SUSPENDED', 'DELETED');

-- CreateEnum
CREATE TYPE "VaultCategory" AS ENUM ('ACCOUNTS', 'MESSAGES', 'FINANCES');

-- CreateEnum
CREATE TYPE "UrgencyLevel" AS ENUM ('IMMEDIATE', 'WITHIN_30_DAYS', 'DISCRETION');

-- CreateEnum
CREATE TYPE "SyncStatus" AS ENUM ('PENDING', 'SYNCED', 'FAILED');

-- CreateEnum
CREATE TYPE "ContactRole" AS ENUM ('PRACTICAL_MANAGER', 'MEMORY_KEEPER', 'FINANCIAL_EXECUTOR');

-- CreateEnum
CREATE TYPE "TransmissionConfigStatus" AS ENUM ('NOT_CONFIGURED', 'ACTIVE', 'PAUSED', 'TRIGGERED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TransmissionRunStatus" AS ENUM ('TRIGGERED', 'IN_PROGRESS', 'UNLOCKED', 'COMPLETED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ContactStatus" AS ENUM ('ACTIVE', 'BLOCKED');

-- CreateEnum
CREATE TYPE "OtpPurpose" AS ENUM ('EMAIL_VERIFICATION', 'EMAIL_CHANGE', 'PHONE_CHANGE');

-- CreateEnum
CREATE TYPE "CheckinMethod" AS ENUM ('GAME', 'ACTIVITY', 'MANUAL_ADMIN');

-- CreateEnum
CREATE TYPE "GameType" AS ENUM ('RIDDLE', 'MINI_GAME');

-- CreateEnum
CREATE TYPE "QuestionCategory" AS ENUM ('CHILDHOOD', 'PLACES', 'EVENTS', 'PEOPLE', 'HABITS', 'OTHER');

-- CreateEnum
CREATE TYPE "QuestionStatus" AS ENUM ('ACTIVE', 'ARCHIVED', 'UNDER_REVIEW');

-- CreateEnum
CREATE TYPE "AdminRole" AS ENUM ('SUPER_ADMIN', 'ADMIN', 'SUPPORT', 'FINANCE');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('USER', 'ADMIN', 'CONTACT', 'SYSTEM');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'GRACE', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "EmailStatus" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'BOUNCED', 'FAILED');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "firstName" VARCHAR(80) NOT NULL,
    "lastName" VARCHAR(80) NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "phone" VARCHAR(32),
    "passwordHash" VARCHAR(255) NOT NULL,
    "ed25519PublicKey" BYTEA,
    "language" "Language" NOT NULL DEFAULT 'FR',
    "plan" "Plan" NOT NULL DEFAULT 'FREE',
    "status" "UserStatus" NOT NULL DEFAULT 'PENDING_VERIFICATION',
    "seedWordsAcknowledgedAt" TIMESTAMP(3),
    "contactsWarningAckAt" TIMESTAMP(3),
    "seedWordsRevealedAt" TIMESTAMP(3),
    "emailVerifiedAt" TIMESTAMP(3),
    "lastActiveAt" TIMESTAMP(3),
    "suspendedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "refreshTokenHash" CHAR(64) NOT NULL,
    "deviceLabel" VARCHAR(120),
    "ipHash" CHAR(64),
    "userAgent" VARCHAR(255),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "two_factors" (
    "userId" UUID NOT NULL,
    "totpSecretEnc" BYTEA NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "activatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "two_factors_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "two_factor_recovery_codes" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "codeHash" CHAR(64) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "two_factor_recovery_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_otps" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "purpose" "OtpPurpose" NOT NULL,
    "codeHash" VARCHAR(255) NOT NULL,
    "pendingValue" VARCHAR(255),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_otps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_resets" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" CHAR(64) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_resets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "restore_challenges" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "nonce" BYTEA NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "restore_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vault_syncs" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "category" "VaultCategory" NOT NULL,
    "storjKey" VARCHAR(255),
    "version" INTEGER NOT NULL DEFAULT 0,
    "sizeBytes" INTEGER NOT NULL DEFAULT 0,
    "payloadHash" BYTEA,
    "payloadSignature" BYTEA,
    "hcvKeyVersion" INTEGER,
    "status" "SyncStatus" NOT NULL DEFAULT 'PENDING',
    "failureReason" VARCHAR(255),
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vault_syncs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vault_items" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "category" "VaultCategory" NOT NULL,
    "contentEnc" BYTEA NOT NULL,
    "urgency" "UrgencyLevel" NOT NULL DEFAULT 'DISCRETION',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "vault_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transmission_configs" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "status" "TransmissionConfigStatus" NOT NULL DEFAULT 'NOT_CONFIGURED',
    "threshold" INTEGER NOT NULL DEFAULT 2,
    "totalShares" INTEGER NOT NULL DEFAULT 2,
    "silenceDurationMonths" INTEGER NOT NULL DEFAULT 3,
    "checkinFrequencyWeeks" INTEGER NOT NULL DEFAULT 4,
    "pausedAt" TIMESTAMP(3),
    "pauseEndsAt" TIMESTAMP(3),
    "activatedAt" TIMESTAMP(3),
    "deactivatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transmission_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trusted_contacts" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "notificationEnc" BYTEA NOT NULL,
    "notificationSig" BYTEA NOT NULL,
    "secretEnc" BYTEA NOT NULL,
    "roles" "ContactRole"[],
    "verifyToken" BYTEA,
    "verifyLastCheckedAt" TIMESTAMP(3),
    "status" "ContactStatus" NOT NULL DEFAULT 'ACTIVE',
    "failedAttempts" INTEGER NOT NULL DEFAULT 0,
    "blockedUntil" TIMESTAMP(3),
    "notifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trusted_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trusted_contact_questions" (
    "id" UUID NOT NULL,
    "contactId" UUID NOT NULL,
    "questionId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trusted_contact_questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trusted_contact_shares" (
    "id" UUID NOT NULL,
    "contactId" UUID NOT NULL,
    "category" "VaultCategory" NOT NULL,
    "shareIndex" INTEGER NOT NULL,
    "shareEnc" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trusted_contact_shares_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_recipients" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "category" "VaultCategory" NOT NULL,
    "contactId" UUID,
    "externalEmailEnc" BYTEA,
    "externalEmailSig" BYTEA,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "data_recipients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checkin_states" (
    "userId" UUID NOT NULL,
    "lastCheckinAt" TIMESTAMP(3),
    "nextDueAt" TIMESTAMP(3) NOT NULL,
    "remindersCount" INTEGER NOT NULL DEFAULT 0,
    "lastReminderAt" TIMESTAMP(3),
    "currentStreak" INTEGER NOT NULL DEFAULT 0,
    "longestStreak" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "checkin_states_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "checkin_records" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "method" "CheckinMethod" NOT NULL,
    "gameId" UUID,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "checkin_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checkin_games" (
    "id" UUID NOT NULL,
    "type" "GameType" NOT NULL,
    "promptFr" TEXT NOT NULL,
    "promptEn" TEXT NOT NULL,
    "answerHash" VARCHAR(255) NOT NULL,
    "payload" JSONB,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "checkin_games_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reminders" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "level" INTEGER NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "viaPush" BOOLEAN NOT NULL DEFAULT false,
    "viaEmail" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "reminders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_questions" (
    "id" UUID NOT NULL,
    "textFr" TEXT NOT NULL,
    "textEn" TEXT NOT NULL,
    "monthSlot" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "journal_questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_entries" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "questionId" UUID,
    "month" CHAR(7) NOT NULL,
    "mode" VARCHAR(32) NOT NULL,
    "contentEnc" BYTEA NOT NULL,
    "wordCountApprox" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "journal_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wrappeds" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "year" INTEGER NOT NULL,
    "summaryEnc" BYTEA,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wrappeds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transmission_runs" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "status" "TransmissionRunStatus" NOT NULL DEFAULT 'TRIGGERED',
    "threshold" INTEGER NOT NULL,
    "totalShares" INTEGER NOT NULL,
    "contactsNotified" INTEGER NOT NULL DEFAULT 0,
    "triggeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "escrowExpiresAt" TIMESTAMP(3) NOT NULL,
    "escrowExtensions" INTEGER NOT NULL DEFAULT 0,
    "unlockedAt" TIMESTAMP(3),
    "accessExpiresAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" VARCHAR(255),

    CONSTRAINT "transmission_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transmission_category_states" (
    "id" UUID NOT NULL,
    "runId" UUID NOT NULL,
    "category" "VaultCategory" NOT NULL,
    "sharesCollected" INTEGER NOT NULL DEFAULT 0,
    "unlockedAt" TIMESTAMP(3),
    "purgedAt" TIMESTAMP(3),

    CONSTRAINT "transmission_category_states_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "relay_tokens" (
    "id" UUID NOT NULL,
    "runId" UUID NOT NULL,
    "contactId" UUID NOT NULL,
    "tokenHash" CHAR(64) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "verifiedAt" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "relay_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "escrow_shares" (
    "id" UUID NOT NULL,
    "runId" UUID NOT NULL,
    "contactId" UUID NOT NULL,
    "category" "VaultCategory" NOT NULL,
    "shareIndex" INTEGER NOT NULL,
    "shareTmpEnc" BYTEA NOT NULL,
    "sessionKeyId" VARCHAR(64) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "escrow_shares_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "relay_task_progress" (
    "id" UUID NOT NULL,
    "runId" UUID NOT NULL,
    "itemRef" VARCHAR(64) NOT NULL,
    "doneAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "relay_task_progress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transmission_logs" (
    "id" UUID NOT NULL,
    "runId" UUID NOT NULL,
    "userRef" CHAR(64) NOT NULL,
    "category" "VaultCategory",
    "event" VARCHAR(64) NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,

    CONSTRAINT "transmission_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "secret_questions" (
    "id" UUID NOT NULL,
    "textFr" TEXT NOT NULL,
    "textEn" TEXT NOT NULL,
    "category" "QuestionCategory" NOT NULL,
    "reliabilityScore" INTEGER NOT NULL DEFAULT 6,
    "status" "QuestionStatus" NOT NULL DEFAULT 'ACTIVE',
    "riskNotes" TEXT,
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "secret_questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_users" (
    "id" UUID NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "passwordHash" VARCHAR(255) NOT NULL,
    "totpSecretEnc" BYTEA NOT NULL,
    "totpEnabled" BOOLEAN NOT NULL DEFAULT false,
    "role" "AdminRole" NOT NULL,
    "disabled" BOOLEAN NOT NULL DEFAULT false,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admin_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_sessions" (
    "id" UUID NOT NULL,
    "adminId" UUID NOT NULL,
    "refreshTokenHash" CHAR(64) NOT NULL,
    "ipHash" CHAR(64),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "actorType" "ActorType" NOT NULL,
    "actorId" UUID,
    "adminId" UUID,
    "action" VARCHAR(80) NOT NULL,
    "targetType" VARCHAR(40),
    "targetId" VARCHAR(64),
    "beforeValue" JSONB,
    "afterValue" JSONB,
    "ipHash" CHAR(64),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_config" (
    "key" VARCHAR(64) NOT NULL,
    "value" JSONB NOT NULL,
    "description" VARCHAR(255),
    "critical" BOOLEAN NOT NULL DEFAULT false,
    "updatedById" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_config_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "support_tickets" (
    "id" UUID NOT NULL,
    "userId" UUID,
    "contactEmail" VARCHAR(255),
    "subject" VARCHAR(200) NOT NULL,
    "body" TEXT NOT NULL,
    "status" VARCHAR(24) NOT NULL,
    "priority" VARCHAR(16) NOT NULL,
    "assignedToId" UUID,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "support_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "plan" "Plan" NOT NULL DEFAULT 'FREE',
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "graceEndsAt" TIMESTAMP(3),
    "renewedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "provider" VARCHAR(40),
    "providerRef" VARCHAR(120),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "subscriptionId" UUID NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'XAF',
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "provider" VARCHAR(40),
    "providerRef" VARCHAR(120),
    "grantedByAdminId" UUID,
    "grantReason" VARCHAR(255),
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_logs" (
    "id" UUID NOT NULL,
    "userId" UUID,
    "contactId" UUID,
    "template" VARCHAR(64) NOT NULL,
    "locale" "Language" NOT NULL,
    "status" "EmailStatus" NOT NULL DEFAULT 'QUEUED',
    "providerMessageId" VARCHAR(120),
    "error" VARCHAR(255),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "sentAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_alerts" (
    "id" UUID NOT NULL,
    "type" VARCHAR(64) NOT NULL,
    "severity" VARCHAR(16) NOT NULL,
    "message" VARCHAR(500) NOT NULL,
    "metadata" JSONB,
    "resolvedAt" TIMESTAMP(3),
    "resolvedByAdminId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "system_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_status_plan_idx" ON "users"("status", "plan");

-- CreateIndex
CREATE INDEX "users_createdAt_idx" ON "users"("createdAt");

-- CreateIndex
CREATE INDEX "users_lastActiveAt_idx" ON "users"("lastActiveAt");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_refreshTokenHash_key" ON "sessions"("refreshTokenHash");

-- CreateIndex
CREATE INDEX "sessions_userId_revokedAt_idx" ON "sessions"("userId", "revokedAt");

-- CreateIndex
CREATE INDEX "sessions_expiresAt_idx" ON "sessions"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "two_factor_recovery_codes_userId_codeHash_key" ON "two_factor_recovery_codes"("userId", "codeHash");

-- CreateIndex
CREATE INDEX "email_otps_userId_purpose_consumedAt_idx" ON "email_otps"("userId", "purpose", "consumedAt");

-- CreateIndex
CREATE INDEX "email_otps_expiresAt_idx" ON "email_otps"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "password_resets_tokenHash_key" ON "password_resets"("tokenHash");

-- CreateIndex
CREATE INDEX "password_resets_expiresAt_idx" ON "password_resets"("expiresAt");

-- CreateIndex
CREATE INDEX "restore_challenges_userId_consumedAt_idx" ON "restore_challenges"("userId", "consumedAt");

-- CreateIndex
CREATE INDEX "restore_challenges_expiresAt_idx" ON "restore_challenges"("expiresAt");

-- CreateIndex
CREATE INDEX "vault_syncs_status_idx" ON "vault_syncs"("status");

-- CreateIndex
CREATE UNIQUE INDEX "vault_syncs_userId_category_key" ON "vault_syncs"("userId", "category");

-- CreateIndex
CREATE INDEX "vault_items_userId_category_deletedAt_idx" ON "vault_items"("userId", "category", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "transmission_configs_userId_key" ON "transmission_configs"("userId");

-- CreateIndex
CREATE INDEX "transmission_configs_status_pauseEndsAt_idx" ON "transmission_configs"("status", "pauseEndsAt");

-- CreateIndex
CREATE INDEX "trusted_contacts_userId_status_idx" ON "trusted_contacts"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "trusted_contacts_userId_position_key" ON "trusted_contacts"("userId", "position");

-- CreateIndex
CREATE INDEX "trusted_contact_questions_questionId_idx" ON "trusted_contact_questions"("questionId");

-- CreateIndex
CREATE UNIQUE INDEX "trusted_contact_questions_contactId_position_key" ON "trusted_contact_questions"("contactId", "position");

-- CreateIndex
CREATE INDEX "trusted_contact_shares_category_idx" ON "trusted_contact_shares"("category");

-- CreateIndex
CREATE UNIQUE INDEX "trusted_contact_shares_contactId_category_key" ON "trusted_contact_shares"("contactId", "category");

-- CreateIndex
CREATE UNIQUE INDEX "data_recipients_userId_category_key" ON "data_recipients"("userId", "category");

-- CreateIndex
CREATE INDEX "checkin_states_nextDueAt_idx" ON "checkin_states"("nextDueAt");

-- CreateIndex
CREATE INDEX "checkin_records_userId_completedAt_idx" ON "checkin_records"("userId", "completedAt");

-- CreateIndex
CREATE INDEX "checkin_games_active_type_idx" ON "checkin_games"("active", "type");

-- CreateIndex
CREATE INDEX "reminders_userId_sentAt_idx" ON "reminders"("userId", "sentAt");

-- CreateIndex
CREATE INDEX "journal_questions_active_monthSlot_idx" ON "journal_questions"("active", "monthSlot");

-- CreateIndex
CREATE INDEX "journal_entries_userId_month_idx" ON "journal_entries"("userId", "month");

-- CreateIndex
CREATE UNIQUE INDEX "wrappeds_userId_year_key" ON "wrappeds"("userId", "year");

-- CreateIndex
CREATE INDEX "transmission_runs_status_escrowExpiresAt_idx" ON "transmission_runs"("status", "escrowExpiresAt");

-- CreateIndex
CREATE INDEX "transmission_runs_userId_triggeredAt_idx" ON "transmission_runs"("userId", "triggeredAt");

-- CreateIndex
CREATE UNIQUE INDEX "transmission_category_states_runId_category_key" ON "transmission_category_states"("runId", "category");

-- CreateIndex
CREATE UNIQUE INDEX "relay_tokens_tokenHash_key" ON "relay_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "relay_tokens_expiresAt_idx" ON "relay_tokens"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "relay_tokens_runId_contactId_key" ON "relay_tokens"("runId", "contactId");

-- CreateIndex
CREATE INDEX "escrow_shares_expiresAt_idx" ON "escrow_shares"("expiresAt");

-- CreateIndex
CREATE INDEX "escrow_shares_runId_category_idx" ON "escrow_shares"("runId", "category");

-- CreateIndex
CREATE UNIQUE INDEX "escrow_shares_runId_contactId_category_key" ON "escrow_shares"("runId", "contactId", "category");

-- CreateIndex
CREATE UNIQUE INDEX "relay_task_progress_runId_itemRef_key" ON "relay_task_progress"("runId", "itemRef");

-- CreateIndex
CREATE INDEX "transmission_logs_runId_occurredAt_idx" ON "transmission_logs"("runId", "occurredAt");

-- CreateIndex
CREATE INDEX "secret_questions_status_reliabilityScore_idx" ON "secret_questions"("status", "reliabilityScore");

-- CreateIndex
CREATE INDEX "secret_questions_category_idx" ON "secret_questions"("category");

-- CreateIndex
CREATE UNIQUE INDEX "admin_users_email_key" ON "admin_users"("email");

-- CreateIndex
CREATE INDEX "admin_users_role_disabled_idx" ON "admin_users"("role", "disabled");

-- CreateIndex
CREATE UNIQUE INDEX "admin_sessions_refreshTokenHash_key" ON "admin_sessions"("refreshTokenHash");

-- CreateIndex
CREATE INDEX "admin_sessions_adminId_revokedAt_idx" ON "admin_sessions"("adminId", "revokedAt");

-- CreateIndex
CREATE INDEX "audit_logs_actorType_actorId_createdAt_idx" ON "audit_logs"("actorType", "actorId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_action_createdAt_idx" ON "audit_logs"("action", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_targetType_targetId_idx" ON "audit_logs"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "support_tickets_status_priority_createdAt_idx" ON "support_tickets"("status", "priority", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_userId_key" ON "subscriptions"("userId");

-- CreateIndex
CREATE INDEX "subscriptions_status_expiresAt_idx" ON "subscriptions"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "payments_subscriptionId_createdAt_idx" ON "payments"("subscriptionId", "createdAt");

-- CreateIndex
CREATE INDEX "payments_status_paidAt_idx" ON "payments"("status", "paidAt");

-- CreateIndex
CREATE INDEX "email_logs_userId_createdAt_idx" ON "email_logs"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "email_logs_status_createdAt_idx" ON "email_logs"("status", "createdAt");

-- CreateIndex
CREATE INDEX "email_logs_template_createdAt_idx" ON "email_logs"("template", "createdAt");

-- CreateIndex
CREATE INDEX "system_alerts_resolvedAt_severity_idx" ON "system_alerts"("resolvedAt", "severity");

-- CreateIndex
CREATE INDEX "system_alerts_type_createdAt_idx" ON "system_alerts"("type", "createdAt");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "two_factors" ADD CONSTRAINT "two_factors_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "two_factor_recovery_codes" ADD CONSTRAINT "two_factor_recovery_codes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "two_factors"("userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_otps" ADD CONSTRAINT "email_otps_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_resets" ADD CONSTRAINT "password_resets_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vault_syncs" ADD CONSTRAINT "vault_syncs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vault_items" ADD CONSTRAINT "vault_items_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transmission_configs" ADD CONSTRAINT "transmission_configs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trusted_contacts" ADD CONSTRAINT "trusted_contacts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trusted_contact_questions" ADD CONSTRAINT "trusted_contact_questions_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "trusted_contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trusted_contact_questions" ADD CONSTRAINT "trusted_contact_questions_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "secret_questions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trusted_contact_shares" ADD CONSTRAINT "trusted_contact_shares_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "trusted_contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_recipients" ADD CONSTRAINT "data_recipients_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_recipients" ADD CONSTRAINT "data_recipients_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "trusted_contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkin_states" ADD CONSTRAINT "checkin_states_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkin_records" ADD CONSTRAINT "checkin_records_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkin_records" ADD CONSTRAINT "checkin_records_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "checkin_games"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "journal_questions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wrappeds" ADD CONSTRAINT "wrappeds_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transmission_runs" ADD CONSTRAINT "transmission_runs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transmission_category_states" ADD CONSTRAINT "transmission_category_states_runId_fkey" FOREIGN KEY ("runId") REFERENCES "transmission_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "relay_tokens" ADD CONSTRAINT "relay_tokens_runId_fkey" FOREIGN KEY ("runId") REFERENCES "transmission_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "relay_tokens" ADD CONSTRAINT "relay_tokens_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "trusted_contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "escrow_shares" ADD CONSTRAINT "escrow_shares_runId_fkey" FOREIGN KEY ("runId") REFERENCES "transmission_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "escrow_shares" ADD CONSTRAINT "escrow_shares_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "trusted_contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "relay_task_progress" ADD CONSTRAINT "relay_task_progress_runId_fkey" FOREIGN KEY ("runId") REFERENCES "transmission_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_sessions" ADD CONSTRAINT "admin_sessions_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "admin_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_config" ADD CONSTRAINT "app_config_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_logs" ADD CONSTRAINT "email_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

