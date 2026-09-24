DO $$ BEGIN
 CREATE TYPE "public"."wallet_role" AS ENUM('OWNER', 'AUTH', 'STANDARD', 'RECOVERY');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."nonce_purpose" AS ENUM('LOGIN', 'LINK_WALLET', 'GRANT_AUTH', 'TRANSFER_OWNER', 'RECOVERY');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE "wallets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"address" text NOT NULL,
	"chain_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_wallet_id" uuid NOT NULL,
	"recovery_wallet_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "account_wallet_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"wallet_id" uuid NOT NULL,
	"role" "public"."wallet_role" NOT NULL,
	"granted_by_wallet_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "nonce_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wallet_id" uuid NOT NULL,
	"nonce" text NOT NULL,
	"purpose" "public"."nonce_purpose" NOT NULL,
	"expires_at" timestamp NOT NULL,
	"used_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"wallet_id" uuid NOT NULL,
	"chain_id" integer DEFAULT 11155111 NOT NULL,
	"refresh_token_hash" text NOT NULL,
	"device_name" text NOT NULL,
	"device_type" text NOT NULL,
	"last_ip" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"revoked_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"actor_wallet_id" uuid NOT NULL,
	"action" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_owner_wallet_id_wallets_id_fk" FOREIGN KEY ("owner_wallet_id") REFERENCES "public"."wallets"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_recovery_wallet_id_wallets_id_fk" FOREIGN KEY ("recovery_wallet_id") REFERENCES "public"."wallets"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "account_wallet_roles" ADD CONSTRAINT "account_wallet_roles_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "account_wallet_roles" ADD CONSTRAINT "account_wallet_roles_wallet_id_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "account_wallet_roles" ADD CONSTRAINT "account_wallet_roles_granted_by_wallet_id_wallets_id_fk" FOREIGN KEY ("granted_by_wallet_id") REFERENCES "public"."wallets"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "nonce_challenges" ADD CONSTRAINT "nonce_challenges_wallet_id_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_wallet_id_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_wallet_id_wallets_id_fk" FOREIGN KEY ("actor_wallet_id") REFERENCES "public"."wallets"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "wallets_address_chain_idx" ON "wallets" USING btree ("address","chain_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "account_wallet_roles_account_wallet_role_idx" ON "account_wallet_roles" USING btree ("account_id","wallet_id","role");
--> statement-breakpoint
CREATE UNIQUE INDEX "account_wallet_roles_one_owner_idx" ON "account_wallet_roles" USING btree ("account_id") WHERE "account_wallet_roles"."role" = 'OWNER';
--> statement-breakpoint
CREATE UNIQUE INDEX "account_wallet_roles_one_recovery_idx" ON "account_wallet_roles" USING btree ("account_id") WHERE "account_wallet_roles"."role" = 'RECOVERY';
--> statement-breakpoint
-- The two partial unique indexes above only bound OWNER/RECOVERY to "at most one" per
-- account. This function plus the two deferred constraint triggers below close the
-- remaining gaps required by REQ-DATA-006: every account has *exactly* one OWNER, and
-- accounts.owner_wallet_id always agrees with that OWNER association. Both are deferred
-- to transaction commit so a role/ownership-transfer transaction may pass through a
-- valid intermediate state (e.g. delete old OWNER row, then insert the new one).
CREATE OR REPLACE FUNCTION "public"."check_account_owner_invariant"() RETURNS trigger AS $$
DECLARE
  target_account_id uuid;
  owner_count integer;
  role_owner_id uuid;
  canonical_owner_id uuid;
BEGIN
  IF TG_TABLE_NAME = 'account_wallet_roles' THEN
    target_account_id := COALESCE(NEW.account_id, OLD.account_id);
  ELSE
    target_account_id := NEW.id;
  END IF;

  IF target_account_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- A deferred role trigger can run after its account was legitimately deleted
  -- in the same transaction. The invariant applies only while the account
  -- exists, so do not treat that completed deletion as a zero-owner account.
  PERFORM 1
    FROM "accounts"
    WHERE "id" = target_account_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT count(*), (array_agg(wallet_id ORDER BY wallet_id))[1] INTO owner_count, role_owner_id
    FROM "account_wallet_roles"
    WHERE "account_id" = target_account_id AND "role" = 'OWNER';

  IF owner_count <> 1 THEN
    RAISE EXCEPTION 'account % must have exactly one OWNER, found %', target_account_id, owner_count;
  END IF;

  SELECT "owner_wallet_id" INTO canonical_owner_id
    FROM "accounts"
    WHERE "id" = target_account_id;

  IF canonical_owner_id IS DISTINCT FROM role_owner_id THEN
    RAISE EXCEPTION 'account % owner_wallet_id (%) does not match OWNER role wallet (%)', target_account_id, canonical_owner_id, role_owner_id;
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "account_wallet_roles_owner_invariant"
  AFTER INSERT OR UPDATE OR DELETE ON "account_wallet_roles"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "public"."check_account_owner_invariant"();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "accounts_owner_invariant"
  AFTER INSERT OR UPDATE OF "owner_wallet_id" ON "accounts"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "public"."check_account_owner_invariant"();
