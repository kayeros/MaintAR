using MaintARBackend.Models;
using Microsoft.EntityFrameworkCore;

namespace MaintARBackend.Context;

public class AppDbContext : DbContext
{
    public AppDbContext(DbContextOptions<AppDbContext> options) : base(options)
    {
    }

    public DbSet<User> Users => Set<User>();

    public DbSet<EmailVerificationCodeModel> EmailVerificationCodes => Set<EmailVerificationCodeModel>();

    public DbSet<ResetPasswordCodeModel> ResetPasswordCodes => Set<ResetPasswordCodeModel>();

    public DbSet<EquipmentType> EquipmentTypes => Set<EquipmentType>();

    public DbSet<Equipment> Equipment => Set<Equipment>();

    public DbSet<Component> Components => Set<Component>();

    public DbSet<DefectType> DefectTypes => Set<DefectType>();

    public DbSet<Inspection> Inspections => Set<Inspection>();

    public DbSet<InspectionFinding> InspectionFindings => Set<InspectionFinding>();

    public DbSet<MaintenanceRecord> MaintenanceRecords => Set<MaintenanceRecord>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        // Уникальные поля, по которым идёт поиск.
        modelBuilder.Entity<User>().HasIndex(u => u.Email).IsUnique();
        modelBuilder.Entity<Equipment>().HasIndex(e => e.Code).IsUnique();
        modelBuilder.Entity<Equipment>().HasIndex(e => e.SerialNumber).IsUnique();
        modelBuilder.Entity<DefectType>().HasIndex(d => d.Code).IsUnique();

        // Перечисления храним текстом, чтобы в базе было видно значение, а не число.
        modelBuilder.Entity<Inspection>().Property(i => i.Status).HasConversion<string>().HasMaxLength(30);
        modelBuilder.Entity<Inspection>().Property(i => i.IdentificationMethod).HasConversion<string>().HasMaxLength(30);
        modelBuilder.Entity<InspectionFinding>().Property(f => f.Category).HasConversion<string>().HasMaxLength(30);
        modelBuilder.Entity<MaintenanceRecord>().Property(m => m.Type).HasConversion<string>().HasMaxLength(30);

        // Коды из писем: как в neuronBakcend, по одной строке на пользователя в каждой таблице.
        modelBuilder.Entity<EmailVerificationCodeModel>()
            .HasIndex(e => e.UserId)
            .IsUnique();

        modelBuilder.Entity<EmailVerificationCodeModel>()
            .HasOne(e => e.User)
            .WithOne()
            .HasForeignKey<EmailVerificationCodeModel>(e => e.UserId)
            .OnDelete(DeleteBehavior.Cascade);

        modelBuilder.Entity<ResetPasswordCodeModel>()
            .HasIndex(r => r.UserId)
            .IsUnique();

        modelBuilder.Entity<ResetPasswordCodeModel>()
            .HasOne(r => r.User)
            .WithOne()
            .HasForeignKey<ResetPasswordCodeModel>(r => r.UserId)
            .OnDelete(DeleteBehavior.Cascade);

        // Тип оборудования -> оборудование и дефекты.
        modelBuilder.Entity<Equipment>()
            .HasOne(e => e.EquipmentType)
            .WithMany(t => t.Equipment)
            .HasForeignKey(e => e.EquipmentTypeId)
            .OnDelete(DeleteBehavior.Restrict);

        modelBuilder.Entity<DefectType>()
            .HasOne(d => d.EquipmentType)
            .WithMany(t => t.DefectTypes)
            .HasForeignKey(d => d.EquipmentTypeId)
            .OnDelete(DeleteBehavior.Restrict);

        // Оборудование -> узлы.
        modelBuilder.Entity<Component>()
            .HasOne(c => c.Equipment)
            .WithMany(e => e.Components)
            .HasForeignKey(c => c.EquipmentId)
            .OnDelete(DeleteBehavior.Restrict);

        // Пользователь и оборудование -> проверки.
        modelBuilder.Entity<Inspection>()
            .HasOne(i => i.User)
            .WithMany(u => u.Inspections)
            .HasForeignKey(i => i.UserId)
            .OnDelete(DeleteBehavior.Restrict);

        modelBuilder.Entity<Inspection>()
            .HasOne(i => i.Equipment)
            .WithMany(e => e.Inspections)
            .HasForeignKey(i => i.EquipmentId)
            .OnDelete(DeleteBehavior.Restrict);

        // Проверка -> находки. Находки без проверки не имеют смысла, поэтому удаляются вместе с ней.
        modelBuilder.Entity<InspectionFinding>()
            .HasOne(f => f.Inspection)
            .WithMany(i => i.Findings)
            .HasForeignKey(f => f.InspectionId)
            .OnDelete(DeleteBehavior.Cascade);

        modelBuilder.Entity<InspectionFinding>()
            .HasOne(f => f.Component)
            .WithMany(c => c.Findings)
            .HasForeignKey(f => f.ComponentId)
            .OnDelete(DeleteBehavior.Restrict);

        modelBuilder.Entity<InspectionFinding>()
            .HasOne(f => f.DefectType)
            .WithMany(d => d.Findings)
            .HasForeignKey(f => f.DefectTypeId)
            .OnDelete(DeleteBehavior.Restrict);

        // Узел и пользователь -> работы инженера.
        modelBuilder.Entity<MaintenanceRecord>()
            .HasOne(m => m.Component)
            .WithMany(c => c.MaintenanceRecords)
            .HasForeignKey(m => m.ComponentId)
            .OnDelete(DeleteBehavior.Restrict);

        modelBuilder.Entity<MaintenanceRecord>()
            .HasOne(m => m.User)
            .WithMany(u => u.MaintenanceRecords)
            .HasForeignKey(m => m.UserId)
            .OnDelete(DeleteBehavior.Restrict);

        // Справочники заполняются при создании базы.
        modelBuilder.Entity<EquipmentType>().HasData(SeedData.EquipmentTypes);
        modelBuilder.Entity<DefectType>().HasData(SeedData.DefectTypes);

        base.OnModelCreating(modelBuilder);
    }
}
