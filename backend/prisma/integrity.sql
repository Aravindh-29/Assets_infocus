-- Append to the initial migration after Prisma's CREATE TABLE statements.
-- Prisma 6 cannot represent PostgreSQL partial indexes or CHECK constraints.
CREATE UNIQUE INDEX "AssetAssignment_one_active_per_asset"
  ON "AssetAssignment" ("assetId") WHERE "returnedAt" IS NULL;

ALTER TABLE "AssetAssignment"
  ADD CONSTRAINT "AssetAssignment_return_chronology"
    CHECK ("returnedAt" IS NULL OR "returnedAt" >= "assignedAt"),
  ADD CONSTRAINT "AssetAssignment_expected_return_chronology"
    CHECK ("expectedReturnAt" IS NULL OR "expectedReturnAt" >= "assignedAt");

ALTER TABLE "Asset"
  ADD CONSTRAINT "Asset_purchase_cost_nonnegative"
    CHECK ("purchaseCost" IS NULL OR "purchaseCost" >= 0),
  ADD CONSTRAINT "Asset_warranty_chronology"
    CHECK ("warrantyStart" IS NULL OR "warrantyExpiry" IS NULL OR "warrantyExpiry" >= "warrantyStart");

ALTER TABLE "AssetRepair"
  ADD CONSTRAINT "AssetRepair_cost_nonnegative"
    CHECK ("cost" IS NULL OR "cost" >= 0),
  ADD CONSTRAINT "AssetRepair_chronology"
    CHECK ("closedAt" IS NULL OR "closedAt" >= "openedAt");

ALTER TABLE "AssetTransfer"
  ADD CONSTRAINT "AssetTransfer_different_employees"
    CHECK ("fromEmployeeId" <> "toEmployeeId");

ALTER TABLE "AssetMovement"
  ADD CONSTRAINT "AssetMovement_different_locations"
    CHECK ("fromLocationId" IS NULL OR "fromLocationId" <> "toLocationId");

ALTER TABLE "Offboarding"
  ADD CONSTRAINT "Offboarding_chronology"
    CHECK ("completedAt" IS NULL OR "completedAt" >= "startedAt");

CREATE UNIQUE INDEX "Offboarding_one_in_progress_per_employee"
  ON "Offboarding" ("employeeId") WHERE "status" = 'IN_PROGRESS';

-- History and audit records are append-only, including for administrative API
-- operations. Run the application with a non-owner PostgreSQL role in production
-- so it cannot disable triggers or alter these tables.
CREATE FUNCTION asset_management_reject_history_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: % is prohibited', TG_TABLE_NAME, TG_OP
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER "AssetHistory_append_only"
  BEFORE UPDATE OR DELETE ON "AssetHistory"
  FOR EACH ROW EXECUTE FUNCTION asset_management_reject_history_mutation();
CREATE TRIGGER "AssetHistory_no_truncate"
  BEFORE TRUNCATE ON "AssetHistory"
  FOR EACH STATEMENT EXECUTE FUNCTION asset_management_reject_history_mutation();
CREATE TRIGGER "AuditLog_append_only"
  BEFORE UPDATE OR DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION asset_management_reject_history_mutation();
CREATE TRIGGER "AuditLog_no_truncate"
  BEFORE TRUNCATE ON "AuditLog"
  FOR EACH STATEMENT EXECUTE FUNCTION asset_management_reject_history_mutation();
