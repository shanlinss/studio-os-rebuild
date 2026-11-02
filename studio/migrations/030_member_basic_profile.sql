-- Approved basic HR facts remain independent of login/member activation.
-- NULL means not registered; no historical dates or employment states are inferred.
ALTER TABLE members
 ADD COLUMN job_title text CHECK (job_title IS NULL OR (length(job_title) BETWEEN 1 AND 100 AND job_title = btrim(job_title) AND job_title !~ '[[:cntrl:]]')),
 ADD COLUMN start_date date,
 ADD COLUMN employment_status text CHECK (employment_status IS NULL OR (length(employment_status) BETWEEN 1 AND 40 AND employment_status = btrim(employment_status) AND employment_status !~ '[[:cntrl:]]'));
