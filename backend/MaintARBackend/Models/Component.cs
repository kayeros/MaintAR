using System.ComponentModel.DataAnnotations;

namespace MaintARBackend.Models;

/// <summary>Узел (комплектующее) конкретной единицы оборудования.</summary>
public class Component
{
    public int Id { get; set; }

    public int EquipmentId { get; set; }

    public Equipment Equipment { get; set; } = null!;

    [MaxLength(200)]
    public required string Name { get; set; }

    /// <summary>Нормативный срок службы в месяцах.</summary>
    public int? ServiceLifeMonths { get; set; }

    public DateOnly? InstalledAt { get; set; }

    public DateOnly? LastReplacedAt { get; set; }

    public List<InspectionFinding> Findings { get; set; } = [];

    public List<MaintenanceRecord> MaintenanceRecords { get; set; } = [];
}
