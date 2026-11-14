namespace MaintARBackend.Models
{
    // Строка списка оборудования для главного экрана приложения.
    public class EquipmentListItemDto
    {
        public int Id { get; set; }
        public required string Code { get; set; }
        public required string SerialNumber { get; set; }
        public required string Name { get; set; }
        public required string Model { get; set; }
        public string? Manufacturer { get; set; }
        public required string Type { get; set; }
        public string? Location { get; set; }
        public string? PhotoUrl { get; set; }
        public EquipmentReportStatus Status { get; set; }
        public DateTime? LastInspectionDate { get; set; }
        public int DefectsCount { get; set; }
    }

    // Карточка оборудования: паспорт, узлы, возможные дефекты типа и отчёт по последнему осмотру.
    public class EquipmentDetailsDto
    {
        public int Id { get; set; }
        public required string Code { get; set; }
        public required string SerialNumber { get; set; }
        public required string Name { get; set; }
        public required string Model { get; set; }
        public string? Manufacturer { get; set; }
        public required string Type { get; set; }
        public string? Location { get; set; }
        public string? Description { get; set; }
        public string? PhotoUrl { get; set; }
        public DateOnly? InstalledAt { get; set; }
        public List<ComponentInfoDto> Components { get; set; } = [];
        public List<DefectTypeInfoDto> DefectTypes { get; set; } = [];
        public required EquipmentReportDto Report { get; set; }
    }

    public class ComponentInfoDto
    {
        public int Id { get; set; }
        public required string Name { get; set; }
        public int? ServiceLifeMonths { get; set; }
        public DateOnly? InstalledAt { get; set; }
        public DateOnly? LastReplacedAt { get; set; }
    }

    public class DefectTypeInfoDto
    {
        public required string Code { get; set; }
        public required string Name { get; set; }
        public string? Description { get; set; }
    }
}
