using System.ComponentModel.DataAnnotations;

namespace MaintARBackend.Models;

/// <summary>Конкретная единица оборудования на предприятии.</summary>
public class Equipment
{
    public int Id { get; set; }

    public int EquipmentTypeId { get; set; }

    public EquipmentType EquipmentType { get; set; } = null!;

    /// <summary>Строка, зашитая в QR-код. Уникальная.</summary>
    [MaxLength(100)]
    public required string Code { get; set; }

    /// <summary>Серийный номер с шильдика. Уникальный.</summary>
    [MaxLength(100)]
    public required string SerialNumber { get; set; }

    /// <summary>Модель. Не уникальна: одинаковых экземпляров может быть несколько.</summary>
    [MaxLength(200)]
    public required string Model { get; set; }

    [MaxLength(200)]
    public string? Manufacturer { get; set; }

    /// <summary>Понятное название, например «Задвижка №2».</summary>
    [MaxLength(200)]
    public required string Name { get; set; }

    /// <summary>Где стоит.</summary>
    [MaxLength(200)]
    public string? Location { get; set; }

    /// <summary>Основные характеристики.</summary>
    public string? Description { get; set; }

    public DateOnly? InstalledAt { get; set; }

    /// <summary>Путь к фото-образцу для карточки и ручного выбора.</summary>
    [MaxLength(500)]
    public string? PhotoPath { get; set; }

    public List<Component> Components { get; set; } = [];

    public List<Inspection> Inspections { get; set; } = [];
}
