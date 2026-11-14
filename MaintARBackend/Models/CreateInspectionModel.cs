using System.ComponentModel.DataAnnotations;

namespace MaintARBackend.Models
{
    public class CreateInspectionModel
    {
        [Required]
        public IFormFile Photo { get; set; } = null!;

        // Строка из QR-кода, серийный номер или маркировка.
        [Required]
        public string Value { get; set; } = null!;

        public IdentificationMethod IdentificationMethod { get; set; } = IdentificationMethod.QrCode;
    }
}
