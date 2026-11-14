using System.ComponentModel.DataAnnotations;

namespace MaintARBackend.Models;

/// <summary>Тип оборудования: справочник, заполняется один раз.</summary>
public class EquipmentType
{
    public int Id { get; set; }

    [MaxLength(200)]
    public required string Name { get; set; }

    public List<Equipment> Equipment { get; set; } = [];

    public List<DefectType> DefectTypes { get; set; } = [];
}
