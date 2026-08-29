ALTER TABLE "workspaces" ADD COLUMN "icon_emoji" text DEFAULT '🗂️' NOT NULL;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "icon_color" text DEFAULT 'slate' NOT NULL;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "background" text DEFAULT 'plain' NOT NULL;