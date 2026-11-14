using System.ComponentModel.DataAnnotations;

namespace MaintARBackend.Models;

/// <summary>Пользователь приложения (инженер).</summary>
public class User
{
    public int Id { get; set; }

    [MaxLength(256)]
    public required string Email { get; set; }

    public required string PasswordHash { get; set; }

    [MaxLength(50)]
    public required string UserName { get; set; }

    public bool IsEmailVerified { get; set; }

    public List<Inspection> Inspections { get; set; } = [];

    public List<MaintenanceRecord> MaintenanceRecords { get; set; } = [];
}
