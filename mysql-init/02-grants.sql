-- The default MYSQL_USER is only granted privileges on MYSQL_DATABASE.
-- Prisma Migrate needs to create/drop its shadow database on demand, so grant
-- this (local dev only) user broader rights.
GRANT ALL PRIVILEGES ON *.* TO 'food_finder'@'%' WITH GRANT OPTION;
FLUSH PRIVILEGES;
