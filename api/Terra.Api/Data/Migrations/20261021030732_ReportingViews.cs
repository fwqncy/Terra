using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Terra.Api.Data.Migrations
{
    /// <summary>
    /// SQL Server reporting objects for Power BI / Power Apps: a leaderboard view, a lane
    /// performance view and a stored procedure for at-risk shipments.
    /// </summary>
    public partial class ReportingViews : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                CREATE VIEW dbo.vw_Leaderboard AS
                SELECT
                    RANK() OVER (ORDER BY s.LifetimeAllTime DESC) AS [Rank],
                    p.Name,
                    s.LifetimeAllTime,
                    s.Deliveries,
                    s.Generations,
                    s.Tokens,
                    s.Achievements,
                    s.UpdatedAt
                FROM dbo.GameSaves AS s
                INNER JOIN dbo.Players AS p ON p.Id = s.PlayerId;
                """);

            migrationBuilder.Sql("""
                CREATE VIEW dbo.vw_LanePerformance AS
                SELECT
                    Origin,
                    Destination,
                    MAX(DestinationName) AS DestinationName,
                    Mode,
                    COUNT(*) AS Volume,
                    SUM(CASE WHEN DeliveredAt IS NOT NULL THEN 1 ELSE 0 END) AS Delivered,
                    CAST(AVG(CASE WHEN OnTime = 1 THEN 1.0 WHEN OnTime = 0 THEN 0.0 END) AS decimal(5, 4)) AS OnTimeRate,
                    SUM(CostAud) AS Revenue,
                    SUM(Co2Kg) AS Co2Kg,
                    SUM(WeightKg / 1000.0 * DistanceKm) AS TonneKm
                FROM dbo.Shipments
                GROUP BY Origin, Destination, Mode;
                """);

            migrationBuilder.Sql("""
                CREATE PROCEDURE dbo.usp_AtRiskShipments
                    @Mode nvarchar(8) = NULL,
                    @Top int = 50
                AS
                BEGIN
                    SET NOCOUNT ON;
                    SELECT TOP (@Top)
                        Id, Mode, Origin, DestinationName, Carrier, Customer, Priority, Status, EtaAt, SlaAt,
                        DATEDIFF(minute, SlaAt, EtaAt) / 60.0 AS HoursPastSla, DelayReason
                    FROM dbo.Shipments
                    WHERE Status <> N'Delivered'
                      AND EtaAt > SlaAt
                      AND (@Mode IS NULL OR Mode = @Mode)
                    ORDER BY CASE Priority WHEN N'Critical' THEN 0 WHEN N'Express' THEN 1 ELSE 2 END, HoursPastSla DESC;
                END
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("DROP PROCEDURE IF EXISTS dbo.usp_AtRiskShipments;");
            migrationBuilder.Sql("DROP VIEW IF EXISTS dbo.vw_LanePerformance;");
            migrationBuilder.Sql("DROP VIEW IF EXISTS dbo.vw_Leaderboard;");
        }
    }
}
