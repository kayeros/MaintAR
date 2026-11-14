using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace MaintARBackend.Models
{
    public class ResetPasswordCodeModel
    {
        [Key]
        public int Id { get; set; }

        public int UserId { get; set; }

        [ForeignKey(nameof(UserId))]
        public User User { get; set; } = null!;

        public required string CodeHash { get; set; }

        public DateTime ExpiresAt { get; set; }
    }
}
