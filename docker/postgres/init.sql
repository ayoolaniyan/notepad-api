-- Runs once, when the postgres volume is first created.
-- One database per service, matching "each service owns its database".
CREATE DATABASE notepad_auth;
CREATE DATABASE notepad_notes;
