using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MaintARBackend.Migrations;

/// <inheritdoc />
public partial class _20261114104651_AddEmailVerificationAndPasswordReset : Migration
{
    /// <inheritdoc />
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.AddColumn<bool>(
            name: "IsEmailVerified",
            table: "Users",
            type: "bit",
            nullable: false,
            defaultValue: false);

        migrationBuilder.CreateTable(
            name: "VerificationCodes",
            columns: table => new
            {
                Id = table.Column<int>(type: "int", nullable: false)
                    .Annotation("SqlServer:Identity", "1, 1"),
                UserId = table.Column<int>(type: "int", nullable: false),
                Purpose = table.Column<string>(type: "nvarchar(30)", maxLength: 30, nullable: false),
                CodeHash = table.Column<string>(type: "nvarchar(max)", nullable: false),
                ExpiresAt = table.Column<DateTime>(type: "datetime2", nullable: false),
                FailedAttempts = table.Column<int>(type: "int", nullable: false),
                SentAt = table.Column<DateTime>(type: "datetime2", nullable: false)
            },
            constraints: table =>
            {
                table.PrimaryKey("PK_VerificationCodes", x => x.Id);
                table.ForeignKey(
                    name: "FK_VerificationCodes_Users_UserId",
                    column: x => x.UserId,
                    principalTable: "Users",
                    principalColumn: "Id",
                    onDelete: ReferentialAction.Cascade);
            });

        migrationBuilder.CreateIndex(
            name: "IX_VerificationCodes_UserId_Purpose",
            table: "VerificationCodes",
            columns: new[] { "UserId", "Purpose" },
            unique: true);
    }

    /// <inheritdoc />
    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropTable(
            name: "VerificationCodes");

        migrationBuilder.DropColumn(
            name: "IsEmailVerified",
            table: "Users");
    }
}
