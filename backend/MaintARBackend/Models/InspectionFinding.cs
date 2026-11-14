namespace MaintARBackend.Models;

/// <summary>Результат ИИ по одному узлу в рамках одной проверки.</summary>
public class InspectionFinding
{
    public int Id { get; set; }

    public int InspectionId { get; set; }

    public Inspection Inspection { get; set; } = null!;

    public int ComponentId { get; set; }

    public Component Component { get; set; } = null!;

    /// <summary>Заполняется только когда найден дефект из справочника.</summary>
    public int? DefectTypeId { get; set; }

    public DefectType? DefectType { get; set; }

    public FindingCategory Category { get; set; }

    /// <summary>Уверенность модели от 0 до 1, если модель её отдаёт.</summary>
    public double? Confidence { get; set; }

    /// <summary>Краткое объяснение причины предупреждения.</summary>
    public string? Explanation { get; set; }

    public string? Recommendation { get; set; }

    // Рамка узла на фото для AR-метки, в долях от размера кадра (0..1).
    public double? BoxX { get; set; }

    public double? BoxY { get; set; }

    public double? BoxWidth { get; set; }

    public double? BoxHeight { get; set; }
}
