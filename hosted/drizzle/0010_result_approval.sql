CREATE TABLE score_approvals (
 score_id INTEGER PRIMARY KEY REFERENCES scores(id),
 approved_by INTEGER NOT NULL REFERENCES users(id),
 approved_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
