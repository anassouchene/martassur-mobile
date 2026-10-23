using Microsoft.EntityFrameworkCore;
using SmartAssur.Api.Models;

namespace SmartAssur.Api.Data
{
    public class SmartAssurDbContext : DbContext
    {
        public SmartAssurDbContext(DbContextOptions<SmartAssurDbContext> options) : base(options) { }

        public DbSet<InsuranceSession> InsuranceSessions => Set<InsuranceSession>();
        public DbSet<TacEntry> TacCatalog => Set<TacEntry>();
        public DbSet<MobileDevice> MobileDevices => Set<MobileDevice>();
        public DbSet<DeviceFieldSource> DeviceFieldSources => Set<DeviceFieldSource>();
        public DbSet<InsuranceApplication> InsuranceApplications => Set<InsuranceApplication>();
        public DbSet<DeviceEvidence> DeviceEvidences => Set<DeviceEvidence>();
        public DbSet<DeviceCheck> DeviceChecks => Set<DeviceCheck>();
        public DbSet<RiskEvent> RiskEvents => Set<RiskEvent>();
        public DbSet<ReviewLog> ReviewLogs => Set<ReviewLog>();
        public DbSet<AdminUser> AdminUsers => Set<AdminUser>();

        protected override void OnModelCreating(ModelBuilder modelBuilder)
        {
            base.OnModelCreating(modelBuilder);

            modelBuilder.Entity<InsuranceSession>()
                .HasIndex(s => s.SessionToken)
                .IsUnique();

            modelBuilder.Entity<MobileDevice>()
                .HasIndex(d => d.ImeiHmacIndex);

            modelBuilder.Entity<MobileDevice>()
                .HasMany(d => d.FieldSources)
                .WithOne()
                .HasForeignKey(f => f.DeviceId);

            modelBuilder.Entity<InsuranceApplication>()
                .HasIndex(a => a.ApplicationRef)
                .IsUnique();

            modelBuilder.Entity<InsuranceApplication>()
                .HasMany(a => a.Checks)
                .WithOne()
                .HasForeignKey(c => c.ApplicationId);

            modelBuilder.Entity<InsuranceApplication>()
                .HasMany(a => a.Evidences)
                .WithOne()
                .HasForeignKey(e => e.ApplicationId);

            modelBuilder.Entity<InsuranceApplication>()
                .HasMany(a => a.RiskEvents)
                .WithOne()
                .HasForeignKey(r => r.ApplicationId);

            modelBuilder.Entity<InsuranceApplication>()
                .HasMany(a => a.ReviewLogs)
                .WithOne()
                .HasForeignKey(l => l.ApplicationId);

            modelBuilder.Entity<DeviceEvidence>()
                .HasIndex(e => e.Sha256Hash);
        }
    }
}

