namespace MaintARBackend.Models
{
    // Строка в истории проверок.
    public class InspectionSummaryDto
    {
        public int Id { get; set; }
        public DateTime CreatedAt { get; set; }
        public InspectionStatus Status { get; set; }
        public IdentificationMethod IdentificationMethod { get; set; }
        public int EquipmentId { get; set; }
        public required string EquipmentCode { get; set; }
        public required string EquipmentName { get; set; }
        public required string EquipmentModel { get; set; }

        // Для незавершённых проверок результата нет.
        public EquipmentReportStatus? Result { get; set; }
        public int DefectsCount { get; set; }
        public string? PhotoPath { get; set; }

        // Кто проводил осмотр (заполняется в истории по оборудованию).
        public string? UserName { get; set; }
    }

    // Подробности одной проверки: все находки по узлам.
    public class InspectionDetailsDto
    {
        public required InspectionSummaryDto Summary { get; set; }
        public string? PhotoPath { get; set; }
        public List<ComponentDefectsDto> Components { get; set; } = [];
    }

    public class PagedResult<T>
    {
        public int Page { get; set; }
        public int PageSize { get; set; }
        public int TotalCount { get; set; }
        public List<T> Items { get; set; } = [];
    }
}
