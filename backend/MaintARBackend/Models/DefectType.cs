using System.ComponentModel.DataAnnotations;

namespace MaintARBackend.Models;

/// <summary>Типовой дефект: справочник, заполняется один раз.</summary>
public class DefectType
{
    public int Id { get; set; }

    public int EquipmentTypeId { get; set; }

    public EquipmentType EquipmentType { get; set; } = null!;

    /// <summary>Короткий код, по которому бэк и сервер ИИ понимают друг друга. Уникальный.</summary>
    [MaxLength(100)]
    public required string Code { get; set; }

    [MaxLength(200)]
    public required string Name { get; set; }

    /// <summary>Визуальные признаки дефекта.</summary>
    public required string Description { get; set; }

    public List<InspectionFinding> Findings { get; set; } = [];
}
