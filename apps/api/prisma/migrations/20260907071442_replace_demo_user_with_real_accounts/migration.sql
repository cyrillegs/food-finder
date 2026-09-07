-- BREAKING MIGRATION - requires a coordinated deploy with the code that
-- expects this new shape. See the PR description ("Migration safety") for
-- the full reasoning. Summary: production currently has one real DemoUser
-- row (id 1, real Stripe history) and real RecentSearch rows tied to it.
-- This migration drops DemoUser outright rather than transforming it into a
-- User row - there is no email/password to migrate it to (DemoUser never
-- had a password), so there is nothing meaningful to carry over
-- automatically. RecentSearch's FK column is renamed (not dropped/recreated)
-- so its rows survive the migration, but their userId values will reference
-- whatever User row ends up with the old DemoUser's id (1) post-migration -
-- likely a seeded demo account, not "the same person" in any real sense.
-- This is a known, accepted side effect for a portfolio project's demo data,
-- not something this migration attempts to reconcile.

-- DropTable
DROP TABLE `DemoUser`;

-- CreateTable
CREATE TABLE `User` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `email` VARCHAR(191) NOT NULL,
    `passwordHash` VARCHAR(191) NOT NULL,
    `stripeCustomerId` VARCHAR(191) NULL,
    `stripeSubscriptionId` VARCHAR(191) NULL,
    `subscriptionStatus` VARCHAR(191) NOT NULL DEFAULT 'inactive',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `User_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Session` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `tokenHash` VARCHAR(191) NOT NULL,
    `userId` INTEGER NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `Session_tokenHash_key`(`tokenHash`),
    INDEX `Session_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- RenameColumn: RecentSearch.demoUserId -> RecentSearch.userId. A rename
-- (not a drop+recreate) so existing RecentSearch rows/data survive the
-- migration itself - see the note at the top of this file for what their
-- userId values mean afterward.
ALTER TABLE `RecentSearch` RENAME COLUMN `demoUserId` TO `userId`;

-- RenameIndex: MySQL doesn't rename an existing index when its underlying
-- column is renamed, so the old `_demoUserId_idx` index is dropped and
-- recreated under the name Prisma would generate for the new column.
DROP INDEX `RecentSearch_demoUserId_idx` ON `RecentSearch`;
CREATE INDEX `RecentSearch_userId_idx` ON `RecentSearch`(`userId`);
