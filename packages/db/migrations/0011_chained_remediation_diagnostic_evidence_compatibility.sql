DROP TRIGGER IF EXISTS chained_remediation_run_guard;
DROP TRIGGER IF EXISTS chained_remediation_attempt_guard;

CREATE TRIGGER chained_remediation_run_guard BEFORE INSERT ON editorial_chained_execution_remediations WHEN NOT EXISTS (
 SELECT 1 FROM intelligence_runs run
 WHERE run.id=NEW.historical_run_id AND run.workspace_id=NEW.workspace_id AND run.project_id=NEW.project_id
 AND run.provider_id=NEW.provider_id AND run.provider_model_id=NEW.provider_model_id
 AND run.task_type='STORYBOARD_PLANNER' AND run.status='FAILED_PERMANENT' AND run.error_category=NEW.failure_category
 AND json_valid(run.safe_metadata_json) AND json_type((CASE WHEN json_valid(run.safe_metadata_json) THEN run.safe_metadata_json ELSE '{}' END),'$.validationDiagnostic')='object'
 AND (SELECT COUNT(*) FROM json_each(run.safe_metadata_json,'$.validationDiagnostic'))=6
 AND json_extract((CASE WHEN json_valid(run.safe_metadata_json) THEN run.safe_metadata_json ELSE '{}' END),'$.validationDiagnostic.validationLayer')='application_schema'
 AND json_extract((CASE WHEN json_valid(run.safe_metadata_json) THEN run.safe_metadata_json ELSE '{}' END),'$.validationDiagnostic.schemaVersion')='storyboard-output-v2'
 AND json_extract((CASE WHEN json_valid(run.safe_metadata_json) THEN run.safe_metadata_json ELSE '{}' END),'$.validationDiagnostic.totalIssueCount')=1
 AND json_extract((CASE WHEN json_valid(run.safe_metadata_json) THEN run.safe_metadata_json ELSE '{}' END),'$.validationDiagnostic.capturedIssueCount')=1
 AND json_extract((CASE WHEN json_valid(run.safe_metadata_json) THEN run.safe_metadata_json ELSE '{}' END),'$.validationDiagnostic.truncated')=0
 AND json_type((CASE WHEN json_valid(run.safe_metadata_json) THEN run.safe_metadata_json ELSE '{}' END),'$.validationDiagnostic.issues')='array'
 AND json_array_length((CASE WHEN json_valid(run.safe_metadata_json) THEN run.safe_metadata_json ELSE '{}' END),'$.validationDiagnostic.issues')=1
 AND json_extract((CASE WHEN json_valid(run.safe_metadata_json) THEN run.safe_metadata_json ELSE '{}' END),'$.validationDiagnostic.issues[0].code')='custom'
 AND json_type((CASE WHEN json_valid(run.safe_metadata_json) THEN run.safe_metadata_json ELSE '{}' END),'$.validationDiagnostic.issues[0].path')='array'
 AND json_array_length((CASE WHEN json_valid(run.safe_metadata_json) THEN run.safe_metadata_json ELSE '{}' END),'$.validationDiagnostic.issues[0].path')=0
 AND json_extract((CASE WHEN json_valid(run.safe_metadata_json) THEN run.safe_metadata_json ELSE '{}' END),'$.validationDiagnostic.issues[0].pathTruncated')=0
 AND (SELECT COUNT(*) FROM json_each(run.safe_metadata_json,'$.validationDiagnostic.issues[0]')) BETWEEN 4 AND 5
 AND (json_type(run.safe_metadata_json,'$.validationDiagnostic.issues[0].message') IS NULL OR json_type(run.safe_metadata_json,'$.validationDiagnostic.issues[0].message')='text')
 AND json_extract((CASE WHEN json_valid(run.safe_metadata_json) THEN run.safe_metadata_json ELSE '{}' END),'$.validationDiagnostic.issues[0].category')='duplicate_continuity_key'
) BEGIN SELECT RAISE(ABORT,'chained_remediation_run_invalid'); END;

CREATE TRIGGER chained_remediation_attempt_guard BEFORE INSERT ON editorial_chained_execution_remediations WHEN NOT EXISTS (
 SELECT 1 FROM intelligence_run_attempts a
 WHERE a.intelligence_run_id=NEW.historical_run_id AND a.attempt_number=1
 AND a.status='FAILED_PERMANENT' AND a.error_category=NEW.failure_category
 AND json_valid(a.safe_metadata_json) AND json_type((CASE WHEN json_valid(a.safe_metadata_json) THEN a.safe_metadata_json ELSE '{}' END),'$.validationDiagnostic')='object'
 AND (SELECT COUNT(*) FROM json_each(a.safe_metadata_json,'$.validationDiagnostic'))=6
 AND json_extract((CASE WHEN json_valid(a.safe_metadata_json) THEN a.safe_metadata_json ELSE '{}' END),'$.validationDiagnostic.validationLayer')='application_schema'
 AND json_extract((CASE WHEN json_valid(a.safe_metadata_json) THEN a.safe_metadata_json ELSE '{}' END),'$.validationDiagnostic.schemaVersion')='storyboard-output-v2'
 AND json_extract((CASE WHEN json_valid(a.safe_metadata_json) THEN a.safe_metadata_json ELSE '{}' END),'$.validationDiagnostic.totalIssueCount')=1
 AND json_extract((CASE WHEN json_valid(a.safe_metadata_json) THEN a.safe_metadata_json ELSE '{}' END),'$.validationDiagnostic.capturedIssueCount')=1
 AND json_extract((CASE WHEN json_valid(a.safe_metadata_json) THEN a.safe_metadata_json ELSE '{}' END),'$.validationDiagnostic.truncated')=0
 AND json_type((CASE WHEN json_valid(a.safe_metadata_json) THEN a.safe_metadata_json ELSE '{}' END),'$.validationDiagnostic.issues')='array'
 AND json_array_length((CASE WHEN json_valid(a.safe_metadata_json) THEN a.safe_metadata_json ELSE '{}' END),'$.validationDiagnostic.issues')=1
 AND json_extract((CASE WHEN json_valid(a.safe_metadata_json) THEN a.safe_metadata_json ELSE '{}' END),'$.validationDiagnostic.issues[0].code')='custom'
 AND json_type((CASE WHEN json_valid(a.safe_metadata_json) THEN a.safe_metadata_json ELSE '{}' END),'$.validationDiagnostic.issues[0].path')='array'
 AND json_array_length((CASE WHEN json_valid(a.safe_metadata_json) THEN a.safe_metadata_json ELSE '{}' END),'$.validationDiagnostic.issues[0].path')=0
 AND json_extract((CASE WHEN json_valid(a.safe_metadata_json) THEN a.safe_metadata_json ELSE '{}' END),'$.validationDiagnostic.issues[0].pathTruncated')=0
 AND (SELECT COUNT(*) FROM json_each(a.safe_metadata_json,'$.validationDiagnostic.issues[0]')) BETWEEN 4 AND 5
 AND (json_type(a.safe_metadata_json,'$.validationDiagnostic.issues[0].message') IS NULL OR json_type(a.safe_metadata_json,'$.validationDiagnostic.issues[0].message')='text')
 AND json_extract((CASE WHEN json_valid(a.safe_metadata_json) THEN a.safe_metadata_json ELSE '{}' END),'$.validationDiagnostic.issues[0].category')='duplicate_continuity_key'
 AND (SELECT COUNT(*) FROM intelligence_run_attempts x WHERE x.intelligence_run_id=NEW.historical_run_id)=1
) BEGIN SELECT RAISE(ABORT,'chained_remediation_attempt_invalid'); END;
