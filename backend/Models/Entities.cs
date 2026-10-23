using System;
using System.Collections.Generic;
using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace SmartAssur.Api.Models
{
    [Table("insurance_sessions")]
    public class InsuranceSession
    {
        [Key]
        [Column("id")]
        public Guid Id { get; set; } = Guid.NewGuid();

        [Column("session_token")]
        [MaxLength(64)]
        public string SessionToken { get; set; } = string.Empty;

        [Column("nonce_hash")]
        [MaxLength(128)]
        public string NonceHash { get; set; } = string.Empty;

        [Column("device_type")]
        [MaxLength(32)]
        public string DeviceType { get; set; } = "desktop";

        [Column("status")]
        [MaxLength(32)]
        public string Status { get; set; } = "PENDING"; // PENDING, PAIRED, IN_PROGRESS, COMPLETED, EXPIRED

        [Column("paired_device_info", TypeName = "jsonb")]
        public string PairedDeviceInfo { get; set; } = "{}";

        [Column("ip_address")]
        [MaxLength(45)]
        public string? IpAddress { get; set; }

        [Column("user_agent")]
        public string? UserAgent { get; set; }

        [Column("expires_at")]
        public DateTime ExpiresAt { get; set; }

        [Column("created_at")]
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    }

    [Table("tac_catalog")]
    public class TacEntry
    {
        [Key]
        [Column("tac")]
        [MaxLength(8)]
        public string Tac { get; set; } = string.Empty;

        [Column("brand")]
        [MaxLength(100)]
        public string Brand { get; set; } = string.Empty;

        [Column("model")]
        [MaxLength(150)]
        public string Model { get; set; } = string.Empty;

        [Column("market_name")]
        [MaxLength(150)]
        public string? MarketName { get; set; }

        [Column("ram_options")]
        [MaxLength(100)]
        public string RamOptions { get; set; } = "6 Go, 8 Go";

        [Column("storage_options")]
        [MaxLength(100)]
        public string StorageOptions { get; set; } = "128 Go, 256 Go";

        [Column("battery_nominal_mah")]
        public int? BatteryNominalMah { get; set; } = 4500;

        [Column("created_at")]
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    }

    [Table("mobile_devices")]
    public class MobileDevice
    {
        [Key]
        [Column("id")]
        public Guid Id { get; set; } = Guid.NewGuid();

        [Column("imei_encrypted")]
        public string ImeiEncrypted { get; set; } = string.Empty;

        [Column("imei_hmac_index")]
        [MaxLength(64)]
        public string ImeiHmacIndex { get; set; } = string.Empty;

        [Column("tac")]
        [MaxLength(8)]
        public string Tac { get; set; } = string.Empty;

        [Column("brand")]
        [MaxLength(100)]
        public string Brand { get; set; } = string.Empty;

        [Column("model")]
        [MaxLength(150)]
        public string Model { get; set; } = string.Empty;

        [Column("ram_gb")]
        [MaxLength(50)]
        public string? RamGb { get; set; }

        [Column("storage_gb")]
        [MaxLength(50)]
        public string? StorageGb { get; set; }

        [Column("battery_nominal_mah")]
        public int? BatteryNominalMah { get; set; }

        [Column("created_at")]
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

        public List<DeviceFieldSource> FieldSources { get; set; } = new();
    }

    [Table("device_fields_sources")]
    public class DeviceFieldSource
    {
        [Key]
        [Column("id")]
        public Guid Id { get; set; } = Guid.NewGuid();

        [Column("device_id")]
        public Guid DeviceId { get; set; }

        [Column("field_name")]
        [MaxLength(50)]
        public string FieldName { get; set; } = string.Empty;

        [Column("source_type")]
        [MaxLength(50)]
        public string SourceType { get; set; } = string.Empty; // TAC_LOOKUP, CATALOGUE, CLIENT_INPUT, USB_ADB, OPERATOR_API

        [Column("source_ref")]
        [MaxLength(255)]
        public string? SourceRef { get; set; }

        [Column("confidence_level")]
        [MaxLength(20)]
        public string ConfidenceLevel { get; set; } = "HIGH"; // HIGH, MEDIUM, LOW

        [Column("created_at")]
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    }

    [Table("insurance_applications")]
    public class InsuranceApplication
    {
        [Key]
        [Column("id")]
        public Guid Id { get; set; } = Guid.NewGuid();

        [Column("application_ref")]
        [MaxLength(32)]
        public string ApplicationRef { get; set; } = string.Empty;

        [Column("session_id")]
        public Guid? SessionId { get; set; }

        [Column("device_id")]
        public Guid DeviceId { get; set; }

        [ForeignKey("DeviceId")]
        public MobileDevice? Device { get; set; }

        [Column("client_name")]
        [MaxLength(150)]
        public string ClientName { get; set; } = string.Empty;

        [Column("client_email")]
        [MaxLength(150)]
        public string ClientEmail { get; set; } = string.Empty;

        [Column("client_phone")]
        [MaxLength(50)]
        public string ClientPhone { get; set; } = string.Empty;

        [Column("status")]
        [MaxLength(50)]
        public string Status { get; set; } = "PENDING_REVIEW"; // PENDING_REVIEW, IN_REVIEW, APPROVED, REJECTED, MORE_DOCS_NEEDED

        [Column("risk_level")]
        [MaxLength(30)]
        public string RiskLevel { get; set; } = "MEDIUM"; // LOW, MEDIUM, HIGH, INCOHERENT

        [Column("verification_mode")]
        [MaxLength(30)]
        public string VerificationMode { get; set; } = "WEB_QR";

        [Column("consent_cndp")]
        public bool ConsentCndp { get; set; } = true;

        [Column("notes")]
        public string? Notes { get; set; }

        [Column("created_at")]
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

        [Column("updated_at")]
        public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

        public List<DeviceEvidence> Evidences { get; set; } = new();
        public List<DeviceCheck> Checks { get; set; } = new();
        public List<RiskEvent> RiskEvents { get; set; } = new();
        public List<ReviewLog> ReviewLogs { get; set; } = new();
    }

    [Table("device_evidence")]
    public class DeviceEvidence
    {
        [Key]
        [Column("id")]
        public Guid Id { get; set; } = Guid.NewGuid();

        [Column("application_id")]
        public Guid? ApplicationId { get; set; }

        [Column("session_id")]
        public Guid? SessionId { get; set; }

        [Column("evidence_type")]
        [MaxLength(50)]
        public string EvidenceType { get; set; } = string.Empty; // PHOTO_FRONT, PHOTO_BACK, SCREENSHOT, DOCUMENT_IMEI

        [Column("file_path")]
        [MaxLength(500)]
        public string FilePath { get; set; } = string.Empty;

        [Column("sha256_hash")]
        [MaxLength(64)]
        public string Sha256Hash { get; set; } = string.Empty;

        [Column("mime_type")]
        [MaxLength(50)]
        public string MimeType { get; set; } = string.Empty;

        [Column("file_size")]
        public long FileSize { get; set; }

        [Column("quality_score")]
        public int QualityScore { get; set; } = 95;

        [Column("quality_flags", TypeName = "jsonb")]
        public string QualityFlags { get; set; } = "{}";

        [Column("source")]
        [MaxLength(50)]
        public string Source { get; set; } = "WEB_CAMERA";

        [Column("captured_at")]
        public DateTime CapturedAt { get; set; } = DateTime.UtcNow;
    }

    [Table("device_checks")]
    public class DeviceCheck
    {
        [Key]
        [Column("id")]
        public Guid Id { get; set; } = Guid.NewGuid();

        [Column("application_id")]
        public Guid ApplicationId { get; set; }

        [Column("check_kind")]
        [MaxLength(60)]
        public string CheckKind { get; set; } = string.Empty;

        [Column("outcome")]
        [MaxLength(30)]
        public string Outcome { get; set; } = "PASSED"; // PASSED, FAILED, WARNING, MANUAL_CHECK

        [Column("details", TypeName = "jsonb")]
        public string Details { get; set; } = "{}";

        [Column("created_at")]
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    }

    [Table("risk_events")]
    public class RiskEvent
    {
        [Key]
        [Column("id")]
        public Guid Id { get; set; } = Guid.NewGuid();

        [Column("application_id")]
        public Guid ApplicationId { get; set; }

        [Column("code")]
        [MaxLength(50)]
        public string Code { get; set; } = string.Empty;

        [Column("severity")]
        [MaxLength(20)]
        public string Severity { get; set; } = "INFO"; // INFO, WARNING, CRITICAL

        [Column("reason")]
        public string Reason { get; set; } = string.Empty;

        [Column("created_at")]
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    }

    [Table("review_log")]
    public class ReviewLog
    {
        [Key]
        [Column("id")]
        public Guid Id { get; set; } = Guid.NewGuid();

        [Column("application_id")]
        public Guid ApplicationId { get; set; }

        [Column("reviewer_id")]
        [MaxLength(100)]
        public string ReviewerId { get; set; } = "GESTIONNAIRE_1";

        [Column("action")]
        [MaxLength(50)]
        public string Action { get; set; } = string.Empty;

        [Column("decision_reason")]
        public string? DecisionReason { get; set; }

        [Column("created_at")]
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    }

    [Table("admin_users")]
    public class AdminUser
    {
        [Key]
        [Column("id")]
        public Guid Id { get; set; } = Guid.NewGuid();

        [Column("username")]
        [MaxLength(64)]
        public string Username { get; set; } = string.Empty;

        [Column("display_name")]
        [MaxLength(120)]
        public string DisplayName { get; set; } = string.Empty;

        [Column("password_hash")]
        public string PasswordHash { get; set; } = string.Empty;

        [Column("role")]
        [MaxLength(32)]
        public string Role { get; set; } = "GESTIONNAIRE"; // GESTIONNAIRE, ADMIN

        [Column("is_active")]
        public bool IsActive { get; set; } = true;

        [Column("last_login_at")]
        public DateTime? LastLoginAt { get; set; }

        [Column("created_at")]
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    }
}
