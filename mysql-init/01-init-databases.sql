-- Runs once on first container boot (mounted into /docker-entrypoint-initdb.d).
-- Creates the test database alongside the primary dev database, which MySQL's
-- own MYSQL_DATABASE env var already creates.
CREATE DATABASE IF NOT EXISTS `food_finder_test` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
