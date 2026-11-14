using System.ComponentModel.DataAnnotations;

namespace MaintARBackend.Models;

/// <summary>Одна проверка: кто, какое оборудование, когда.</summary>
public class Inspection
{
    public int Id { get; set; }

    public int UserId { get; set; }

    public User User { get; set; } = null!;

    public int EquipmentId { get; set; }

    public Equipment Equipment { get; set; } = null!;

    public DateTime CreatedAt { get; set; }

    public InspectionStatus Status { get; set; }

    public IdentificationMethod IdentificationMethod { get; set; }

    /// <summary>Путь к файлу с фото. Само фото в базе не хранится.</summary>
    [MaxLength(500)]
    public string? PhotoPath { get; set; }

    /// <summary>Сырой ответ сервера ИИ, на случай разбора.</summary>
    public string? RawAiResponse { get; set; }

    public List<InspectionFinding> Findings { get; set; } = [];
}
