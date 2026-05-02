import sqlalchemy as sa

from .sessions import Base

class Tasks(Base):
    __tablename__ = "tasks"

    id = sa.Column(sa.Integer, primary_key=True, autoincrement=True, index=True)
    video_feed = sa.Column(sa.Text, nullable=False)
    roi_data = sa.Column(sa.Text, nullable=True)
    status = sa.Column(
        sa.Enum("started", "processing", "completed", "failed", name="task_status"),
        nullable=False,
        server_default="started",
    )
    state = sa.Column(
        sa.Enum("live", "deleted", name="task_state"),
        nullable=False,
        server_default="live",
    )
