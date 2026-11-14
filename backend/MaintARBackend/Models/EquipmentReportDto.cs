namespace MaintARBackend.Models
{
    public enum EquipmentReportStatus
    {
        NotInspected,
        Ok,
        HasDefects
    }

    // Ответ фронту: что за оборудование и в каком оно состоянии по последнему осмотру.
    public class EquipmentReportDto
    {
        public EquipmentReportStatus Status { get; set; }
        public required string Message { get; set; }
        public required EquipmentInfoDto Equipment { get; set; }
        public DateTime? LastInspectionDate { get; set; }
        public List<ComponentDefectsDto> Defects { get; set; } = [];
    }

    public class EquipmentInfoDto
    {
        public int Id { get; set; }
        public required string Code { get; set; }
        public required string SerialNumber { get; set; }
        public required string Name { get; set; }
        public required string Model { get; set; }
        public string? Manufacturer { get; set; }
        public required string Type { get; set; }
        public string? Location { get; set; }
        // Фото оборудования: путь от адреса сервера, например /uploads/equipment/1_20261114.jpg.
        public string? PhotoUrl { get; set; }
    }

    // Дефекты, сгруппированные по узлу.
    public class ComponentDefectsDto
    {
        public int ComponentId { get; set; }
        public required string ComponentName { get; set; }
        public List<DefectDto> Findings { get; set; } = [];
    }

    public class DefectDto
    {
        public FindingCategory Category { get; set; }
        public string? DefectCode { get; set; }
        public string? DefectName { get; set; }
        public string? DefectDescription { get; set; }
        public double? Confidence { get; set; }
        public string? Explanation { get; set; }
        public string? Recommendation { get; set; }

        // Рамка дефекта на фото, доли кадра (левый верхний угол + размер). Есть только у результатов ИИ.
        public double? BoxX { get; set; }
        public double? BoxY { get; set; }
        public double? BoxWidth { get; set; }
        public double? BoxHeight { get; set; }
    }
}
