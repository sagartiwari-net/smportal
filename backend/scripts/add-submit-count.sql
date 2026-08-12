-- Run once on production if prisma db push is not used:
-- mysql smmportal < backend/scripts/add-submit-count.sql

ALTER TABLE `Submission`
  ADD COLUMN `submitCount` INT NOT NULL DEFAULT 0;

UPDATE `Submission` SET `submitCount` = 1 WHERE `submitCount` = 0;
