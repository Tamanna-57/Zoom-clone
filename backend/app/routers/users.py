"""Profile and contact directory."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from .. import schemas
from ..database import get_db
from ..deps import get_current_user
from ..models import Contact, User
from ..serializers import user_public

router = APIRouter(prefix="/api", tags=["users"])


@router.patch("/me", response_model=schemas.UserPublic)
def update_me(
    payload: schemas.UserUpdate,
    current: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    for field, value in payload.model_dump(exclude_unset=True).items():
        if value is not None:
            setattr(current, field, value)
    db.commit()
    db.refresh(current)
    return user_public(current)


@router.get("/users", response_model=list[schemas.UserPublic])
def search_users(
    q: str = Query("", max_length=120),
    limit: int = Query(20, ge=1, le=100),
    current: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    stmt = select(User).where(User.id != current.id)
    if q:
        pattern = f"%{q.lower()}%"
        stmt = stmt.where(or_(User.display_name.ilike(pattern), User.email.ilike(pattern)))
    return [user_public(u) for u in db.scalars(stmt.order_by(User.display_name).limit(limit))]


@router.get("/contacts", response_model=list[schemas.ContactOut])
def list_contacts(current: User = Depends(get_current_user), db: Session = Depends(get_db)):
    stmt = select(Contact).where(Contact.owner_id == current.id)
    contacts = list(db.scalars(stmt))
    contacts.sort(key=lambda c: (not c.starred, c.contact.display_name.lower()))
    return [schemas.ContactOut.model_validate(c) for c in contacts]


@router.post("/contacts", response_model=schemas.ContactOut, status_code=201)
def add_contact(
    payload: schemas.ContactCreate,
    current: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    target = db.scalar(select(User).where(User.email == payload.email.lower()))
    if target is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No Zoomeet user with that e-mail")
    if target.id == current.id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "You cannot add yourself")
    existing = db.scalar(
        select(Contact).where(Contact.owner_id == current.id, Contact.contact_id == target.id)
    )
    if existing:
        raise HTTPException(status.HTTP_409_CONFLICT, "Already in your contacts")
    contact = Contact(owner_id=current.id, contact_id=target.id)
    db.add(contact)
    db.commit()
    db.refresh(contact)
    return schemas.ContactOut.model_validate(contact)


@router.post("/contacts/{contact_id}/star", response_model=schemas.ContactOut)
def toggle_star(
    contact_id: int,
    current: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    contact = db.get(Contact, contact_id)
    if contact is None or contact.owner_id != current.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Contact not found")
    contact.starred = not contact.starred
    db.commit()
    db.refresh(contact)
    return schemas.ContactOut.model_validate(contact)


@router.delete("/contacts/{contact_id}", status_code=204)
def delete_contact(
    contact_id: int,
    current: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    contact = db.get(Contact, contact_id)
    if contact is None or contact.owner_id != current.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Contact not found")
    db.delete(contact)
    db.commit()
