using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace Terra.Api.Data;

public sealed class TerraDbContext(DbContextOptions<TerraDbContext> options) : DbContext(options)
{
    public DbSet<Player> Players => Set<Player>();
    public DbSet<GameSave> GameSaves => Set<GameSave>();
    public DbSet<ShipmentRecord> Shipments => Set<ShipmentRecord>();
    public DbSet<IdempotencyRecord> IdempotencyRecords => Set<IdempotencyRecord>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<Player>(e =>
        {
            e.ToTable("Players");
            e.Property(p => p.Name).HasMaxLength(32).IsRequired();
            e.HasOne(p => p.Save).WithOne(s => s.Player).HasForeignKey<GameSave>(s => s.PlayerId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<GameSave>(e =>
        {
            e.ToTable("GameSaves");
            e.HasKey(s => s.PlayerId);
            e.Property(s => s.StateJson).IsRequired();
            e.Property(s => s.Revision).IsConcurrencyToken();
            e.HasIndex(s => s.LifetimeAllTime).HasDatabaseName("IX_GameSaves_LifetimeAllTime");
        });

        b.Entity<ShipmentRecord>(e =>
        {
            e.ToTable("Shipments");
            e.HasKey(s => s.Id);
            e.Property(s => s.Id).HasMaxLength(20);
            e.Property(s => s.Mode).HasMaxLength(8);
            e.Property(s => s.Origin).HasMaxLength(8);
            e.Property(s => s.Destination).HasMaxLength(8);
            e.Property(s => s.DestinationName).HasMaxLength(64);
            e.Property(s => s.Carrier).HasMaxLength(64);
            e.Property(s => s.Customer).HasMaxLength(64);
            e.Property(s => s.Priority).HasMaxLength(16);
            e.Property(s => s.UnitType).HasMaxLength(16);
            e.Property(s => s.Status).HasMaxLength(16);
            e.Property(s => s.DelayReason).HasMaxLength(64);
            e.HasIndex(s => new { s.Status, s.EtaAt }).HasDatabaseName("IX_Shipments_Status_EtaAt");
            e.HasIndex(s => new { s.Mode, s.Status }).HasDatabaseName("IX_Shipments_Mode_Status");
            e.HasIndex(s => new { s.Origin, s.Destination }).HasDatabaseName("IX_Shipments_Lane");
        });

        b.Entity<IdempotencyRecord>(e =>
        {
            e.ToTable("IdempotencyRecords");
            e.HasKey(r => r.Key);
            e.Property(r => r.Key).HasMaxLength(200);
            e.Property(r => r.Method).HasMaxLength(8);
            e.Property(r => r.Path).HasMaxLength(256);
            e.Property(r => r.ContentType).HasMaxLength(100);
            e.HasIndex(r => r.CreatedAt);
        });
    }
}

/// <summary>Design-time factory so `dotnet ef migrations` targets SQL Server.</summary>
public sealed class DesignTimeFactory : IDesignTimeDbContextFactory<TerraDbContext>
{
    public TerraDbContext CreateDbContext(string[] args)
    {
        var options = new DbContextOptionsBuilder<TerraDbContext>()
            .UseSqlServer("Server=localhost,1433;Database=Terra;User Id=sa;Password=Design-Time-Only1!;TrustServerCertificate=True")
            .Options;
        return new TerraDbContext(options);
    }
}
