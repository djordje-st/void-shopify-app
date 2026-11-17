CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`shop` text NOT NULL,
	`state` text NOT NULL,
	`isOnline` integer DEFAULT false NOT NULL,
	`scope` text,
	`expires` text,
	`accessToken` text NOT NULL,
	`userId` blob,
	`firstName` text,
	`lastName` text,
	`email` text,
	`accountOwner` integer,
	`locale` text,
	`collaborator` integer,
	`emailVerified` integer,
	`refreshToken` text,
	`refreshTokenExpires` text
);
--> statement-breakpoint
CREATE INDEX `session_shop_idx` ON `session` (`shop`);--> statement-breakpoint
CREATE TABLE `shop` (
	`myshopifyDomain` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`shopifyPlan` text NOT NULL,
	`timezone` text NOT NULL,
	`currency` text NOT NULL
);
