-- English values for the member_role enum (#114): only the labels change,
-- stored rows follow automatically. Nothing in the RLS policies, triggers or
-- functions refers to these values.
ALTER TYPE "member_role" RENAME VALUE 'direction' TO 'director';--> statement-breakpoint
ALTER TYPE "member_role" RENAME VALUE 'accueil' TO 'front_desk';--> statement-breakpoint
ALTER TYPE "member_role" RENAME VALUE 'professeur' TO 'teacher';
