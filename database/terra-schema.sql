IF OBJECT_ID(N'[__EFMigrationsHistory]') IS NULL
BEGIN
    CREATE TABLE [__EFMigrationsHistory] (
        [MigrationId] nvarchar(150) NOT NULL,
        [ProductVersion] nvarchar(32) NOT NULL,
        CONSTRAINT [PK___EFMigrationsHistory] PRIMARY KEY ([MigrationId])
    );
END;
GO

BEGIN TRANSACTION;
GO

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261021030729_InitialCreate'
)
BEGIN
    CREATE TABLE [IdempotencyRecords] (
        [Key] nvarchar(200) NOT NULL,
        [Method] nvarchar(8) NOT NULL,
        [Path] nvarchar(256) NOT NULL,
        [StatusCode] int NOT NULL,
        [ContentType] nvarchar(100) NOT NULL,
        [Body] nvarchar(max) NOT NULL,
        [CreatedAt] datetime2 NOT NULL,
        CONSTRAINT [PK_IdempotencyRecords] PRIMARY KEY ([Key])
    );
END;
GO

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261021030729_InitialCreate'
)
BEGIN
    CREATE TABLE [Players] (
        [Id] uniqueidentifier NOT NULL,
        [Name] nvarchar(32) NOT NULL,
        [CreatedAt] datetime2 NOT NULL,
        [UpdatedAt] datetime2 NOT NULL,
        CONSTRAINT [PK_Players] PRIMARY KEY ([Id])
    );
END;
GO

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261021030729_InitialCreate'
)
BEGIN
    CREATE TABLE [Shipments] (
        [Id] nvarchar(20) NOT NULL,
        [Mode] nvarchar(8) NOT NULL,
        [Origin] nvarchar(8) NOT NULL,
        [Destination] nvarchar(8) NOT NULL,
        [DestinationName] nvarchar(64) NOT NULL,
        [Carrier] nvarchar(64) NOT NULL,
        [Customer] nvarchar(64) NOT NULL,
        [Priority] nvarchar(16) NOT NULL,
        [WeightKg] float NOT NULL,
        [Units] int NOT NULL,
        [UnitType] nvarchar(16) NOT NULL,
        [DistanceKm] float NOT NULL,
        [CreatedAt] datetime2 NOT NULL,
        [DepartAt] datetime2 NOT NULL,
        [EtaAt] datetime2 NOT NULL,
        [SlaAt] datetime2 NOT NULL,
        [DeliveredAt] datetime2 NULL,
        [Status] nvarchar(16) NOT NULL,
        [Progress] float NOT NULL,
        [CostAud] float NOT NULL,
        [Co2Kg] float NOT NULL,
        [DelayReason] nvarchar(64) NULL,
        [OnTime] bit NULL,
        [Expedited] bit NOT NULL,
        CONSTRAINT [PK_Shipments] PRIMARY KEY ([Id])
    );
END;
GO

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261021030729_InitialCreate'
)
BEGIN
    CREATE TABLE [GameSaves] (
        [PlayerId] uniqueidentifier NOT NULL,
        [StateJson] nvarchar(max) NOT NULL,
        [Coins] float NOT NULL,
        [Lifetime] float NOT NULL,
        [LifetimeAllTime] float NOT NULL,
        [Tokens] int NOT NULL,
        [Deliveries] int NOT NULL,
        [Generations] int NOT NULL,
        [Achievements] int NOT NULL,
        [LastSeen] datetime2 NOT NULL,
        [UpdatedAt] datetime2 NOT NULL,
        [Revision] int NOT NULL,
        CONSTRAINT [PK_GameSaves] PRIMARY KEY ([PlayerId]),
        CONSTRAINT [FK_GameSaves_Players_PlayerId] FOREIGN KEY ([PlayerId]) REFERENCES [Players] ([Id]) ON DELETE CASCADE
    );
END;
GO

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261021030729_InitialCreate'
)
BEGIN
    CREATE INDEX [IX_GameSaves_LifetimeAllTime] ON [GameSaves] ([LifetimeAllTime]);
END;
GO

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261021030729_InitialCreate'
)
BEGIN
    CREATE INDEX [IX_IdempotencyRecords_CreatedAt] ON [IdempotencyRecords] ([CreatedAt]);
END;
GO

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261021030729_InitialCreate'
)
BEGIN
    CREATE INDEX [IX_Shipments_Lane] ON [Shipments] ([Origin], [Destination]);
END;
GO

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261021030729_InitialCreate'
)
BEGIN
    CREATE INDEX [IX_Shipments_Mode_Status] ON [Shipments] ([Mode], [Status]);
END;
GO

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261021030729_InitialCreate'
)
BEGIN
    CREATE INDEX [IX_Shipments_Status_EtaAt] ON [Shipments] ([Status], [EtaAt]);
END;
GO

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261021030729_InitialCreate'
)
BEGIN
    INSERT INTO [__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES (N'20261021030729_InitialCreate', N'8.0.32');
END;
GO

COMMIT;
GO

BEGIN TRANSACTION;
GO

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261021030732_ReportingViews'
)
BEGIN
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
END;
GO

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261021030732_ReportingViews'
)
BEGIN
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
END;
GO

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261021030732_ReportingViews'
)
BEGIN
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
END;
GO

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261021030732_ReportingViews'
)
BEGIN
    INSERT INTO [__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES (N'20261021030732_ReportingViews', N'8.0.32');
END;
GO

COMMIT;
GO

